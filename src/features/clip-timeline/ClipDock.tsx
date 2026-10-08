import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Camera, Footprints, Smile, Type } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { sampleBone } from '@/lib/motion/evaluate';
import { segment } from '@/lib/clips/bake';
import { trackClips } from '@/lib/clips/ops';
import { snapMove, snapPoint } from '@/lib/clips/snap';
import { figureSegments, posePositions, type SkeletonInfo } from '@/lib/clips/thumb';
import { clipEnd, clipLength, type Clip, type Track, type TrackKind } from '@/lib/clips/types';
import { ct, useClipTimeline } from '@/store/clipTimeline';
import { engineOrNull } from '@/store/engineRef';
import { useLayout } from '@/store/layout';
import { me } from '@/store/motionEditor';
import {
  copySelected,
  deleteSelected,
  duplicateSelected,
  moveTo,
  pasteAtPlayhead,
  reorderTo,
  select,
  splitAtPlayhead,
  trimTo,
} from './actions';
import { ClipToolbar } from './ClipToolbar';
import { getPeaks, getSourceClip } from './sources';
import { dockProbe } from './probe';

const TRACK_ICON: Record<TrackKind, typeof Footprints> = {
  dance: Footprints,
  camera: Camera,
  face: Smile,
  audio: AudioLines,
  text: Type,
};

const TRACK_COLOR: Record<TrackKind, string> = {
  dance: '#6d8bff',
  camera: '#f5b84a',
  face: '#f06292',
  audio: '#4fd18b',
  text: '#ba68c8',
};

const RULER_H = 22;

/** Snapping context for drags. */
function snapCtx(excludeTrackClips: Clip[] = []): Parameters<typeof snapPoint>[1] {
  const s = ct.get();
  const m = me.get();
  return {
    playhead: engineOrNull()?.getPlayback().frame,
    clips: s.doc.clips.filter((c) => !excludeTrackClips.includes(c)),
    markers: m.markers.map((x) => x.f),
    grid: m.grid.bpm > 0 ? m.grid : undefined,
    radius: s.snap ? Math.max(1, 8 / s.ppf) : 0,
  };
}

let dragSeq = 0;

export default function ClipDock() {
  const doc = useClipTimeline((s) => s.doc);
  const ppf = useClipTimeline((s) => s.ppf);
  const center = useClipTimeline((s) => s.centerPlayhead);
  const selection = useClipTimeline((s) => s.selection);
  const coarse = useLayout((s) => s.coarse);
  const rowH = coarse ? 58 : 46;
  const headW = coarse ? 88 : 112;
  const areaRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const width = useRef(600);

  // Scroll position (frame at the left edge) is driven per frame, not through React.
  const scrollRef = useRef(useClipTimeline.getState().scroll);
  const end = Math.max(300, ...doc.clips.map(clipEnd)) + 300;

  const frameAtX = useCallback((clientX: number): number => {
    const r = areaRef.current!.getBoundingClientRect();
    return scrollRef.current + (clientX - r.left) / ct.get().ppf;
  }, []);

  // rAF: scroll (center mode follows the playhead), playhead line, ruler.
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const engine = engineOrNull();
      const s = ct.get();
      const frame = engine?.getPlayback().frame ?? 0;
      const w = width.current;
      if (s.centerPlayhead) scrollRef.current = frame - w / 2 / s.ppf;
      else {
        // Free playhead: keep it in view while playing.
        const x = (frame - scrollRef.current) * s.ppf;
        if (engine?.getPlayback().playing && (x < 0 || x > w - 20)) scrollRef.current = frame - 40 / s.ppf;
        scrollRef.current = Math.max(-20 / s.ppf, scrollRef.current);
      }
      if (contentRef.current) contentRef.current.style.transform = `translateX(${-scrollRef.current * s.ppf}px)`;
      if (headRef.current) headRef.current.style.transform = `translateX(${(frame - scrollRef.current) * s.ppf}px)`;
      drawRuler(rulerRef.current, scrollRef.current, s.ppf, w);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => (width.current = el.clientWidth));
    ro.observe(el);
    width.current = el.clientWidth;
    return () => ro.disconnect();
  }, []);

  // Shortcuts while the clip view is open (capture phase: before the global ones).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const handled = (fn: () => void): void => {
        e.preventDefault();
        e.stopImmediatePropagation();
        fn();
      };
      if (mod && k === 'c') return handled(copySelected);
      if (mod && k === 'v') return handled(pasteAtPlayhead);
      if (mod && k === 'd') return handled(duplicateSelected);
      if (mod || e.altKey) return;
      if (k === 's') return handled(splitAtPlayhead);
      if (e.key === 'Delete' || e.key === 'Backspace') return handled(deleteSelected);
      if (e.key === '+' || e.key === '=') return handled(() => ct.set((s) => ({ ppf: Math.min(40, s.ppf * 1.5) })));
      if (e.key === '-' || e.key === '_') return handled(() => ct.set((s) => ({ ppf: Math.max(0.2, s.ppf / 1.5) })));
      if (e.key === 'Escape' && ct.get().selection.length) return handled(() => select([]));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Probe for automation / tests.
  useEffect(() => {
    dockProbe.clipPoint = (id, at = 0.5) => {
      const el = document.querySelector<HTMLElement>(`[data-clip-id="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width * at, y: r.top + r.height / 2 };
    };
    dockProbe.frameX = (f) => {
      const r = areaRef.current!.getBoundingClientRect();
      return r.left + (f - scrollRef.current) * ct.get().ppf;
    };
    return () => {
      dockProbe.clipPoint = undefined;
      dockProbe.frameX = undefined;
    };
  }, []);

  // Empty-area gestures: tap seeks / clears selection; drag pans (free) or scrubs (center); pinch zooms.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x0: number; scroll0: number; frame0: number; moved: boolean; pinch?: { d: number; ppf: number } } | null>(null);
  const onAreaDown = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('[data-clip-id]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { x0: (a.x + b.x) / 2, scroll0: scrollRef.current, frame0: 0, moved: true, pinch: { d: Math.abs(a.x - b.x) || 1, ppf: ct.get().ppf } };
      return;
    }
    const onRuler = e.clientY - areaRef.current!.getBoundingClientRect().top < RULER_H;
    if (onRuler && !ct.get().centerPlayhead) {
      engineOrNull()?.seek(Math.max(0, Math.round(frameAtX(e.clientX))));
      gesture.current = { x0: e.clientX, scroll0: scrollRef.current, frame0: -1, moved: true };
      return;
    }
    gesture.current = { x0: e.clientX, scroll0: scrollRef.current, frame0: engineOrNull()?.getPlayback().frame ?? 0, moved: false };
  };
  const onAreaMove = (e: React.PointerEvent): void => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.abs(a.x - b.x) || 1;
      zoomAround(g.pinch.ppf * (d / g.pinch.d), (a.x + b.x) / 2);
      return;
    }
    if (g.frame0 === -1) {
      engineOrNull()?.seek(Math.max(0, Math.round(frameAtX(e.clientX))));
      return;
    }
    const dx = e.clientX - g.x0;
    if (!g.moved && Math.abs(dx) < 5) return;
    g.moved = true;
    const p = ct.get().ppf;
    if (ct.get().centerPlayhead) engineOrNull()?.seek(Math.max(0, Math.round(g.frame0 - dx / p)));
    else scrollRef.current = g.scroll0 - dx / p;
  };
  const onAreaUp = (e: React.PointerEvent): void => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g && !g.moved && !g.pinch) {
      select([]);
      if (!ct.get().centerPlayhead) engineOrNull()?.seek(Math.max(0, Math.round(frameAtX(e.clientX))));
    }
    if (pointers.current.size === 0) {
      gesture.current = null;
      ct.set({ scroll: scrollRef.current });
    }
  };

  const zoomAround = (next: number, clientX: number): void => {
    const p = Math.min(40, Math.max(0.2, next));
    const r = areaRef.current!.getBoundingClientRect();
    const anchor = frameAtX(clientX);
    ct.set({ ppf: p });
    if (!ct.get().centerPlayhead) scrollRef.current = anchor - (clientX - r.left) / p;
  };
  const onWheel = (e: React.WheelEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      zoomAround(ct.get().ppf * Math.exp(-e.deltaY * 0.002), e.clientX);
      return;
    }
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (d && !ct.get().centerPlayhead) scrollRef.current += d / ct.get().ppf;
  };

  const tracks = doc.tracks;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-panel" data-testid="clip-dock">
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="shrink-0 border-r border-line" style={{ width: headW }}>
          <div style={{ height: RULER_H }} className="border-b border-line" />
          {tracks.map((t) => (
            <TrackHeader key={t.id} track={t} height={rowH} />
          ))}
        </div>
        <div
          ref={areaRef}
          className="relative min-w-0 flex-1 touch-none select-none overflow-hidden"
          onPointerDown={onAreaDown}
          onPointerMove={onAreaMove}
          onPointerUp={onAreaUp}
          onPointerCancel={onAreaUp}
          onWheel={onWheel}
          data-testid="clip-area"
          style={{ minHeight: RULER_H + Math.max(1, tracks.length) * rowH }}
        >
          <canvas ref={rulerRef} className="absolute inset-x-0 top-0" style={{ height: RULER_H }} />
          <div ref={contentRef} className="absolute left-0 top-0" style={{ width: end * ppf, top: RULER_H }}>
            {tracks.map((t, i) => (
              <div key={t.id} className="absolute inset-x-0 border-b border-line/60" style={{ top: i * rowH, height: rowH }} data-track-id={t.id}>
                {trackClips(doc, t.id).map((c) => (
                  <ClipBlock
                    key={c.id}
                    clip={c}
                    track={t}
                    ppf={ppf}
                    height={rowH}
                    selected={selection.includes(c.id)}
                    tracks={tracks}
                    frameAtX={frameAtX}
                  />
                ))}
              </div>
            ))}
          </div>
          {!tracks.length && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-[12px] text-fg-dim" style={{ top: RULER_H }}>
              Add dances, a camera, face presets, music or 3D text with the + button. Clips never change the motions they come from.
            </div>
          )}
          <div
            ref={headRef}
            className={cn('pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-accent', center && 'shadow-[0_0_0_1px_rgba(109,139,255,0.4)]')}
            aria-hidden
          />
        </div>
      </div>
      <ClipToolbar />
    </div>
  );
}

function drawRuler(canvas: HTMLCanvasElement | null, scroll: number, ppf: number, width: number): void {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(RULER_H * dpr);
    canvas.style.width = `${width}px`;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#14161c';
  ctx.fillRect(0, 0, width, RULER_H);
  const steps = [1, 5, 10, 15, 30, 60, 150, 300, 900, 1800];
  const step = steps.find((s) => s * ppf >= 56) ?? 3600;
  ctx.fillStyle = '#8b93a7';
  ctx.font = '10px ui-monospace, monospace';
  const m = me.get();
  if (m.grid.bpm > 0) {
    const beat = (60 / m.grid.bpm) * 30;
    if (beat * ppf > 6) {
      ctx.fillStyle = 'rgba(109,139,255,0.35)';
      for (let f = m.grid.offset + Math.ceil((scroll - m.grid.offset) / beat) * beat; f < scroll + width / ppf; f += beat)
        ctx.fillRect(Math.round((f - scroll) * ppf), RULER_H - 5, 1, 5);
    }
  }
  ctx.fillStyle = '#8b93a7';
  for (let f = Math.max(0, Math.ceil(scroll / step) * step); f < scroll + width / ppf; f += step) {
    const x = Math.round((f - scroll) * ppf);
    ctx.fillRect(x, RULER_H - 8, 1, 8);
    const sec = f / 30;
    ctx.fillText(step >= 30 ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : String(f), x + 3, 11);
  }
  ctx.fillStyle = '#ffd54f';
  for (const mk of m.markers) {
    const x = (mk.f - scroll) * ppf;
    if (x >= 0 && x <= width) ctx.fillRect(Math.round(x), 0, 1, RULER_H);
  }
}

function TrackHeader({ track, height }: { track: Track; height: number }) {
  const Icon = TRACK_ICON[track.kind];
  return (
    <div
      className="flex items-center gap-1.5 border-b border-line/60 px-2 text-[11px] text-fg-muted"
      style={{ height }}
      title={track.name}
      data-track-header={track.kind}
    >
      <Icon size={13} style={{ color: TRACK_COLOR[track.kind] }} className="shrink-0" />
      <span className="truncate">{track.name}</span>
    </div>
  );
}

const ClipBlock = memo(function ClipBlock({
  clip,
  track,
  ppf,
  height,
  selected,
  tracks,
  frameAtX,
}: {
  clip: Clip;
  track: Track;
  ppf: number;
  height: number;
  selected: boolean;
  tracks: Track[];
  frameAtX: (x: number) => number;
}) {
  const len = clipLength(clip);
  const left = clip.startFrame * ppf;
  const w = Math.max(6, len * ppf);
  const color = TRACK_COLOR[track.kind];
  const src = useClipTimeline((s) => (clip.sourceId ? s.doc.sources.find((x) => x.id === clip.sourceId) : undefined));
  const [lifted, setLifted] = useState(false);
  const [dropX, setDropX] = useState<number | null>(null);
  const coarse = useLayout((s) => s.coarse);
  const handleW = coarse ? 16 : 8;
  const label = clip.text ? clip.text.content.split('\n')[0] || 'Text' : (src?.name ?? 'clip');

  const drag = useRef<{
    mode: 'move' | 'start' | 'end' | 'reorder';
    x0: number;
    y0: number;
    start0: number;
    moved: boolean;
    key: string;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);

  const onDown = (e: React.PointerEvent, mode: 'move' | 'start' | 'end'): void => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const sel = ct.get().selection;
    if (e.shiftKey || e.ctrlKey || e.metaKey) select(sel.includes(clip.id) ? sel.filter((x) => x !== clip.id) : [...sel, clip.id]);
    else if (!sel.includes(clip.id)) select([clip.id]);
    const d = { mode, x0: e.clientX, y0: e.clientY, start0: clip.startFrame, moved: false, key: `drag-${++dragSeq}` } as NonNullable<typeof drag.current>;
    if (mode === 'move') {
      // Long-press, then drag: reorder (ripple) within the track.
      d.timer = setTimeout(() => {
        if (drag.current === d && !d.moved) {
          d.mode = 'reorder';
          setLifted(true);
        }
      }, 450);
    }
    drag.current = d;
  };

  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 4 && Math.abs(e.clientY - d.y0) < 4) return;
    d.moved = true;
    if (d.timer) clearTimeout(d.timer);
    const p = ct.get().ppf;
    if (d.mode === 'reorder') {
      setDropX(e.clientX);
      return;
    }
    if (d.mode === 'move') {
      // Track under the pointer (same kind only).
      const rowEl = (document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset?.trackId) as HTMLElement | undefined);
      const target = rowEl?.dataset.trackId;
      const targetTrack = tracks.find((t) => t.id === target && t.kind === track.kind);
      const s = snapMove(d.start0 + dx / p, len, snapCtx([clip]), clip.id);
      moveTo(clip.id, s.start, targetTrack?.id, d.key);
      return;
    }
    const f = snapPoint(frameAtX(e.clientX), snapCtx([clip]), clip.id).frame;
    trimTo(clip.id, d.mode, f, d.key);
  };

  const onUp = (e: React.PointerEvent): void => {
    const d = drag.current;
    drag.current = null;
    if (d?.timer) clearTimeout(d.timer);
    setLifted(false);
    setDropX(null);
    if (d?.mode === 'reorder' && d.moved) {
      const f = frameAtX(e.clientX);
      const list = trackClips(ct.get().doc, clip.trackId).filter((c) => c.id !== clip.id);
      const index = list.filter((c) => c.startFrame + clipLength(c) / 2 < f).length;
      reorderTo(clip.id, index);
    }
  };

  return (
    <div
      data-clip-id={clip.id}
      data-clip-kind={track.kind}
      data-selected={selected || undefined}
      role="button"
      aria-label={`${track.kind} clip ${label}`}
      aria-pressed={selected}
      tabIndex={0}
      className={cn(
        'absolute top-1 overflow-hidden rounded-md border text-[10px] text-white transition-shadow',
        selected ? 'border-white shadow-[0_0_0_2px_rgba(255,255,255,0.35)]' : 'border-black/30',
        lifted && 'z-10 scale-[1.03] opacity-90 shadow-2xl',
      )}
      style={{ left, width: w, height: height - 8, background: `${color}cc` }}
      onPointerDown={(e) => onDown(e, 'move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => void import('./advanced').then((a) => a.openAdvanced(clip.id))}
    >
      <ClipContent clip={clip} kind={track.kind} width={w} height={height - 8} modelId={track.modelId} />
      <div className="pointer-events-none absolute left-1 top-0.5 flex max-w-[calc(100%-8px)] items-center gap-1 truncate font-medium drop-shadow">
        <span className="truncate">{label}</span>
        {clip.speed !== 1 && <span className="rounded bg-black/40 px-0.5">{clip.speed}×</span>}
        {clip.mirror && <span className="rounded bg-black/40 px-0.5">⇋</span>}
        {clip.loopCount > 1 && <span className="rounded bg-black/40 px-0.5">↻{clip.loopCount}</span>}
      </div>
      {selected && (
        <>
          <div
            className="absolute inset-y-0 left-0 cursor-ew-resize bg-white/40"
            style={{ width: handleW }}
            onPointerDown={(e) => onDown(e, 'start')}
            onPointerMove={onMove}
            onPointerUp={onUp}
            data-trim="start"
          />
          <div
            className="absolute inset-y-0 right-0 cursor-ew-resize bg-white/40"
            style={{ width: handleW }}
            onPointerDown={(e) => onDown(e, 'end')}
            onPointerMove={onMove}
            onPointerUp={onUp}
            data-trim="end"
          />
        </>
      )}
      {dropX !== null && <div className="pointer-events-none fixed inset-y-0 w-0.5 bg-white" style={{ left: dropX }} />}
    </div>
  );
});

/** Pose thumbnails (dance), waveform (audio), or nothing (label only). */
function ClipContent({ clip, kind, width, height, modelId }: { clip: Clip; kind: TrackKind; width: number; height: number; modelId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rev = useClipTimeline((s) => s.sourcesRevision);
  const skel = useMemo<SkeletonInfo | null>(() => (modelId ? (engineOrNull()?.getSkeleton(modelId) ?? null) : null), [modelId]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.min(width, 4000);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, height);
    if (kind === 'audio' && clip.sourceId) {
      const peaks = getPeaks(clip.sourceId);
      if (!peaks) return;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      const len = clipLength(clip);
      for (let x = 0; x < W; x++) {
        const f = Math.floor(clip.sourceIn + (x / W) * len);
        const v = peaks[Math.min(peaks.length - 1, Math.max(0, f))] ?? 0;
        const h = Math.max(1, v * (height - 14));
        ctx.fillRect(x, 12 + (height - 12 - h) / 2, 1, h);
      }
      return;
    }
    if ((kind === 'dance' || kind === 'face') && clip.sourceId && skel) {
      const source = getSourceClip(clip.sourceId);
      if (!source || kind === 'face') return;
      const seg = segment(source, clip);
      const len = clipLength(clip);
      const cell = Math.max(28, height - 12);
      const n = Math.max(1, Math.floor(W / cell));
      const segs = figureSegments(skel);
      const tracksByName = new Map(seg.bones.map((t) => [t.name, t.keys]));
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < n; i++) {
        const f = (i / n) * len;
        const pos = posePositions(skel, (name) => {
          const keys = tracksByName.get(name);
          return keys ? sampleBone(keys, f) : null;
        });
        const ys = pos.map((p) => p[1]);
        const top = Math.max(...ys);
        const bottom = Math.min(...ys, 0);
        const s = (cell - 6) / Math.max(1, top - bottom);
        const cx = i * (W / n) + W / n / 2;
        ctx.beginPath();
        for (const [a, b] of segs) {
          ctx.moveTo(cx + pos[a][0] * s, height - 3 - (pos[a][1] - bottom) * s);
          ctx.lineTo(cx + pos[b][0] * s, height - 3 - (pos[b][1] - bottom) * s);
        }
        ctx.stroke();
      }
    }
  }, [clip, kind, width, height, skel, rev]);
  if (kind === 'camera' || kind === 'text') return null;
  return <canvas ref={ref} className="pointer-events-none absolute left-0 top-0" style={{ width: Math.min(width, 4000), height }} />;
}
