import {
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Square,
  StepBack,
  StepForward,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconButton, NumberField, Select } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { engineOrNull } from '@/store/engineRef';
import { useLayout } from '@/store/layout';
import { usePlaybackClock } from '@/hooks/usePlaybackClock';
import type { PlaybackState } from '@/engine/types';
import { pinchScale, pinchState, type Point } from '@/lib/gestures';
import { setLoop, setSpeed, togglePlay } from '@/store/actions';
import { useStudio } from '@/store/studio';
import {
  formatTimecode,
  frameToX,
  keyframeColumns,
  MMD_FPS,
  rulerStep,
  snapFrame,
  xToFrame,
  zoomAt,
  type TimelineView,
} from '@/lib/timeline';

const ROW_H = 22;
const RULER_H = 22;
const LABEL_W = 168;

interface Row {
  key: string;
  label: string;
  kind: 'audio' | 'camera' | 'model' | 'bones' | 'morphs' | 'track';
  frames?: number[];
  color: string;
  depth: number;
  expandable?: boolean;
}

function mergeFrames(lists: number[][]): number[] {
  const set = new Set<number>();
  for (const l of lists) for (const f of l) set.add(f);
  return [...set].sort((a, b) => a - b);
}

export function Timeline() {
  const playback = useStudio((s) => s.playback);
  const models = useStudio((s) => s.models);
  const cameraMotion = useStudio((s) => s.cameraMotion);
  const audio = useStudio((s) => s.audio);
  const audioOffset = useStudio((s) => s.audioOffsetMs);
  const [view, setView] = useState<TimelineView>({ start: 0, zoom: 2 });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [width, setWidth] = useState(600);
  const [height, setHeight] = useState(120);
  const [scrollTop, setScrollTop] = useState(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const scrubbing = useRef(false);
  const coarse = useLayout((st) => st.coarse);
  const viewRef = useRef(view);
  viewRef.current = view;

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (audio)
      out.push({ key: 'audio', label: `♪ ${audio.info.name}`, kind: 'audio', color: '#4fd18b', depth: 0 });
    if (cameraMotion)
      out.push({
        key: 'camera',
        label: `Camera · ${cameraMotion.info.name}`,
        kind: 'camera',
        frames: cameraMotion.info.frames,
        color: '#f5b84a',
        depth: 0,
      });
    for (const m of models) {
      if (!m.motion) continue;
      const bones = m.motion.groups.filter((g) => g.kind === 'bone');
      const morphs = m.motion.groups.filter((g) => g.kind === 'morph');
      const key = `m:${m.id}`;
      out.push({
        key,
        label: m.name,
        kind: 'model',
        frames: mergeFrames(m.motion.groups.map((g) => g.frames)),
        color: '#6d8bff',
        depth: 0,
        expandable: true,
      });
      if (!expanded[key]) continue;
      const bk = `${key}:bones`;
      out.push({
        key: bk,
        label: `Bones (${bones.length})`,
        kind: 'bones',
        frames: mergeFrames(bones.map((g) => g.frames)),
        color: '#859dff',
        depth: 1,
        expandable: bones.length > 0,
      });
      if (expanded[bk])
        for (const g of bones)
          out.push({
            key: `${bk}:${g.name}`,
            label: g.name,
            kind: 'track',
            frames: g.frames,
            color: '#a3b5ff',
            depth: 2,
          });
      const mk = `${key}:morphs`;
      out.push({
        key: mk,
        label: `Morphs (${morphs.length})`,
        kind: 'morphs',
        frames: mergeFrames(morphs.map((g) => g.frames)),
        color: '#e58bd8',
        depth: 1,
        expandable: morphs.length > 0,
      });
      if (expanded[mk])
        for (const g of morphs)
          out.push({
            key: `${mk}:${g.name}`,
            label: g.name,
            kind: 'track',
            frames: g.frames,
            color: '#f0aee6',
            depth: 2,
          });
    }
    return out;
  }, [models, cameraMotion, audio, expanded]);

  // resize tracking
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(Math.max(50, el.clientWidth - LABEL_W));
      setHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(
    (frameOverride?: number) => {
      const canvas = canvasRef.current;
      const ruler = rulerRef.current;
      if (!canvas || !ruler) return;
      const dpr = window.devicePixelRatio || 1;
      const v = viewRef.current;
      const pb = engineOrNull()?.getPlayback() ?? playback;
      const frame = frameOverride ?? pb.frame;
      const duration = pb.duration;
      for (const c of [canvas, ruler]) {
        const h = c === ruler ? RULER_H : height;
        if (c.width !== Math.round(width * dpr) || c.height !== Math.round(h * dpr)) {
          c.width = Math.round(width * dpr);
          c.height = Math.round(h * dpr);
          c.style.width = `${width}px`;
          c.style.height = `${h}px`;
        }
      }
      // ruler
      const r = ruler.getContext('2d')!;
      r.setTransform(dpr, 0, 0, dpr, 0, 0);
      r.fillStyle = '#161920';
      r.fillRect(0, 0, width, RULER_H);
      const step = rulerStep(v.zoom);
      const first = Math.floor(v.start / step) * step;
      r.font = '10px ui-monospace, monospace';
      r.textBaseline = 'top';
      for (let f = first; frameToX(f, v) < width; f += step) {
        const x = Math.round(frameToX(f, v)) + 0.5;
        if (x < 0) continue;
        r.fillStyle = '#3a4150';
        r.fillRect(x, RULER_H - 8, 1, 8);
        r.fillStyle = '#9aa1b2';
        r.fillText(
          step >= MMD_FPS && f % MMD_FPS === 0 ? formatTimecode(f).slice(0, 5) : String(f),
          x + 3,
          4,
        );
      }
      if (duration > 0) {
        const endX = frameToX(duration, v);
        r.fillStyle = 'rgba(255,107,107,0.6)';
        r.fillRect(endX, 0, 1, RULER_H);
      }
      // tracks
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0f1115';
      ctx.fillRect(0, 0, width, height);
      if (duration > 0) {
        const endX = frameToX(duration, v);
        if (endX < width) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(Math.max(0, endX), 0, width, height);
        }
      }
      // grid
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      for (let f = first; frameToX(f, v) < width; f += step)
        ctx.fillRect(Math.round(frameToX(f, v)), 0, 1, height);
      rows.forEach((row, i) => {
        const y = i * ROW_H - scrollTop;
        if (y + ROW_H < 0 || y > height) return;
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.015)' : 'transparent';
        ctx.fillRect(0, y, width, ROW_H);
        ctx.fillStyle = '#1d212b';
        ctx.fillRect(0, y + ROW_H - 1, width, 1);
        if (row.kind === 'audio' && audio) {
          const peaks = audio.info.peaks;
          const pps = audio.info.peaksPerSecond;
          const offsetFrames = (audioOffset / 1000) * MMD_FPS;
          ctx.fillStyle = 'rgba(79,209,139,0.65)';
          const mid = y + ROW_H / 2;
          for (let x = 0; x < width; x++) {
            const fr = xToFrame(x, v) + offsetFrames;
            const idx0 = Math.floor((fr / MMD_FPS) * pps);
            const idx1 = Math.max(
              idx0 + 1,
              Math.floor(((xToFrame(x + 1, v) + offsetFrames) / MMD_FPS) * pps),
            );
            if (idx0 < 0 || idx0 >= peaks.length) continue;
            let p = 0;
            for (let k = idx0; k < Math.min(idx1, peaks.length); k++) p = Math.max(p, peaks[k]);
            const h = Math.max(1, p * (ROW_H - 4));
            ctx.fillRect(x, mid - h / 2, 1, h);
          }
          return;
        }
        const cols = keyframeColumns(row.frames ?? [], v, width);
        ctx.fillStyle = row.color;
        const small = row.kind === 'track';
        for (const x of cols) {
          if (v.zoom >= 4) {
            // diamonds when zoomed in
            const cy = y + ROW_H / 2;
            const s = small ? 3 : 4;
            ctx.beginPath();
            ctx.moveTo(x, cy - s);
            ctx.lineTo(x + s, cy);
            ctx.lineTo(x, cy + s);
            ctx.lineTo(x - s, cy);
            ctx.fill();
          } else {
            ctx.fillRect(x, y + (small ? 7 : 5), 1, ROW_H - (small ? 14 : 10));
          }
        }
      });
      // playhead
      const px = Math.round(frameToX(frame, v)) + 0.5;
      if (px >= 0 && px <= width) {
        ctx.fillStyle = '#ff6b6b';
        ctx.fillRect(px - 0.5, 0, 1.5, height);
        r.fillStyle = '#ff6b6b';
        r.beginPath();
        // Touch: a large grab handle on the playhead.
        const hw = coarse ? 9 : 5;
        r.moveTo(px - hw, 0);
        r.lineTo(px + hw, 0);
        r.lineTo(px + hw, coarse ? 10 : 0);
        r.lineTo(px, coarse ? RULER_H - 2 : 7);
        r.lineTo(px - hw, coarse ? 10 : 0);
        r.fill();
        r.fillRect(px - 0.5, 0, coarse ? 2 : 1.5, RULER_H);
      }
    },
    [width, height, rows, scrollTop, audio, audioOffset, playback, coarse],
  );

  // redraw on data changes
  useEffect(() => {
    draw();
  }, [draw, view]);

  // smooth playhead while playing (+ auto page)
  useEffect(() => {
    if (!playback.playing) return;
    let raf = 0;
    const loop = (): void => {
      const pb = engineOrNull()?.getPlayback();
      if (pb) {
        const v = viewRef.current;
        const x = frameToX(pb.frame, v);
        if (!scrubbing.current && (x > width - 20 || x < 0))
          setView({ ...v, start: Math.max(0, pb.frame - 10 / v.zoom) });
        draw(pb.frame);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playback.playing, draw, width]);

  const seekFromEvent = (clientX: number, target: HTMLElement): void => {
    const rect = target.getBoundingClientRect();
    const f = snapFrame(xToFrame(clientX - rect.left, viewRef.current), playback.duration);
    engineOrNull()?.seek(f);
    draw(f);
  };

  // One finger/mouse scrubs; two fingers pinch-zoom the time range and pan it.
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; center: Point; view: TimelineView; anchor: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      scrubbing.current = false;
      const [a, b] = [...pointers.current.values()];
      const st = pinchState(a, b);
      const rect = target.getBoundingClientRect();
      pinch.current = {
        ...st,
        view: viewRef.current,
        anchor: xToFrame(st.center.x - rect.left, viewRef.current),
      };
      return;
    }
    scrubbing.current = true;
    const engine = engineOrNull();
    if (engine?.getPlayback().playing) engine.pause();
    seekFromEvent(e.clientX, target);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const st = pinchState(a, b);
      const zoomed = zoomAt(p.view, p.anchor, pinchScale(p.distance, st.distance), 0.05, 40);
      // Keep the anchor frame under the fingers' midpoint while they move (pan).
      const panFrames = (p.center.x - st.center.x) / zoomed.zoom;
      setView({ zoom: zoomed.zoom, start: Math.max(0, zoomed.start + panFrames) });
      return;
    }
    if (scrubbing.current) seekFromEvent(e.clientX, e.currentTarget);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) scrubbing.current = false;
  };

  // Native non-passive wheel listener so Ctrl+wheel zooms the timeline instead of the page.
  useEffect(() => {
    const onWheel = (e: WheelEvent): void => {
      const target = e.currentTarget as HTMLCanvasElement;
      const rect = target.getBoundingClientRect();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        const anchor = xToFrame(e.clientX - rect.left, v);
        setView(zoomAt(v, anchor, e.deltaY < 0 ? 1.2 : 1 / 1.2, 0.05, 40));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const d = (e.shiftKey ? e.deltaY : e.deltaX) / v.zoom;
        setView({ ...v, start: Math.max(0, v.start + d) });
      }
    };
    const els = [canvasRef.current, rulerRef.current].filter((x): x is HTMLCanvasElement => x !== null);
    for (const el of els) el.addEventListener('wheel', onWheel, { passive: false });
    return () => els.forEach((el) => el.removeEventListener('wheel', onWheel));
  }, []);

  const fit = (): void => {
    const d = Math.max(30, playback.duration);
    setView({ start: 0, zoom: Math.max(0.05, (width - 20) / d) });
  };

  const zoomBy = (factor: number): void => setView(zoomAt(view, playback.frame, factor, 0.05, 40));

  const totalHeight = rows.length * ROW_H;

  return (
    <div className="flex h-full flex-col bg-bg-panel" aria-label="Timeline">
      <TransportBar onFit={fit} onZoom={zoomBy} />
      <div className="flex border-b border-line" style={{ height: RULER_H }}>
        <div
          className="flex shrink-0 items-center border-r border-line px-2 text-[11px] text-fg-dim"
          style={{ width: LABEL_W }}
        >
          {rows.length ? 'Tracks' : ''}
        </div>
        <canvas
          ref={rulerRef}
          className="cursor-ew-resize touch-none"
          aria-label="Timeline ruler — click or drag to scrub"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
      <div ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="absolute inset-0 overflow-y-auto"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div style={{ height: Math.max(totalHeight, height) }} className="relative">
            <div
              className="absolute left-0 top-0 border-r border-line bg-bg-panel"
              style={{ width: LABEL_W, height: Math.max(totalHeight, height) }}
            >
              {rows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center gap-1 truncate border-b border-[#1d212b] pr-2 text-[11px]"
                  style={{ height: ROW_H, paddingLeft: 6 + row.depth * 12 }}
                >
                  {row.expandable ? (
                    <button
                      type="button"
                      aria-label={expanded[row.key] ? `Collapse ${row.label}` : `Expand ${row.label}`}
                      aria-expanded={!!expanded[row.key]}
                      className="rounded text-fg-dim hover:text-fg"
                      onClick={() => setExpanded((x) => ({ ...x, [row.key]: !x[row.key] }))}
                    >
                      {expanded[row.key] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  ) : (
                    <span className="inline-block w-3" />
                  )}
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: row.color }} />
                  <span
                    className={cn('truncate', row.kind === 'track' ? 'text-fg-dim' : 'text-fg-muted')}
                    title={row.label}
                  >
                    {row.label}
                  </span>
                </div>
              ))}
            </div>
            <canvas
              ref={canvasRef}
              className="sticky top-0 cursor-ew-resize touch-none"
              style={{ marginLeft: LABEL_W }}
              aria-label="Timeline tracks — click or drag to scrub, Ctrl+wheel to zoom, Shift+wheel to pan"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </div>
        </div>
        {rows.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center pl-[168px] text-[12px] text-fg-dim">
            Motion keyframes, the camera track and the audio waveform appear here.
          </div>
        )}
      </div>
    </div>
  );
}

function TransportBar({ onFit, onZoom }: { onFit: () => void; onZoom: (f: number) => void }) {
  const pb = useStudio((s) => s.playback);
  const engine = engineOrNull;
  const timeRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  // Updated per animation frame via refs, not React state.
  const paint = useCallback((p: PlaybackState) => {
    if (timeRef.current) timeRef.current.textContent = formatTimecode(p.frame);
    if (totalRef.current) totalRef.current.textContent = `/ ${formatTimecode(p.duration)}`;
  }, []);
  usePlaybackClock(paint);
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2"
      role="toolbar"
      aria-label="Transport"
    >
      <IconButton label="Jump to start (Home)" onClick={() => engine()?.seek(0)}>
        <SkipBack size={15} />
      </IconButton>
      <IconButton label="Previous frame (←)" onClick={() => engine()?.stepFrames(-1)}>
        <StepBack size={15} />
      </IconButton>
      <IconButton
        label={pb.playing ? 'Pause (Space)' : 'Play (Space)'}
        onClick={togglePlay}
        className="bg-accent-soft !text-accent"
        data-testid="play-toggle"
      >
        {pb.playing ? <Pause size={16} /> : <Play size={16} />}
      </IconButton>
      <IconButton label="Stop" onClick={() => engine()?.stop()}>
        <Square size={13} />
      </IconButton>
      <IconButton label="Next frame (→)" onClick={() => engine()?.stepFrames(1)}>
        <StepForward size={15} />
      </IconButton>
      <IconButton label="Jump to end (End)" onClick={() => engine()?.seek(pb.duration)}>
        <SkipForward size={15} />
      </IconButton>
      <IconButton label="Loop (L)" active={pb.loop} onClick={() => setLoop(!pb.loop)}>
        <Repeat size={15} />
      </IconButton>
      <div
        className="ml-2 flex items-center gap-2 font-mono text-[12px] tabular-nums"
        aria-live="off"
        data-testid="timecode"
      >
        <span ref={timeRef}>{formatTimecode(pb.frame)}</span>
        <span ref={totalRef} className="text-fg-dim">
          / {formatTimecode(pb.duration)}
        </span>
      </div>
      <div className="ml-2 w-16">
        <NumberField
          label="Current frame"
          value={Math.round(pb.frame)}
          precision={0}
          step={1}
          onChange={(f) => engine()?.seek(f)}
        />
      </div>
      <div className="flex-1" />
      <Select
        hideLabel
        label="Playback speed"
        value={String(pb.speed)}
        onChange={(v) => setSpeed(Number(v))}
        options={['0.25', '0.5', '0.75', '1', '1.25', '1.5', '2'].map((v) => ({ value: v, label: `${v}×` }))}
      />
      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton label="Zoom out timeline" onClick={() => onZoom(1 / 1.5)}>
        <ZoomOut size={15} />
      </IconButton>
      <IconButton label="Zoom in timeline" onClick={() => onZoom(1.5)}>
        <ZoomIn size={15} />
      </IconButton>
      <IconButton label="Fit timeline to duration" onClick={onFit}>
        <Maximize2 size={14} />
      </IconButton>
    </div>
  );
}
