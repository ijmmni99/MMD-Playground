import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NameLabel } from '@/features/names/NameLabel';
import { bezierWeight, CURVE_PRESETS, presetOf, type CurvePreset } from '@/lib/motion/bezier';
import {
  channelDefs,
  keyCurve,
  sampleChannels,
  setChannelValue,
  setCurves,
  trackKeyFrames,
} from '@/lib/motion/curves';
import { CAMERA_TRACK, keyId, parseKeyId, type KeyRef, type MotionClip } from '@/lib/motion/types';
import { cn } from '@/components/ui/cn';
import { engineOrNull } from '@/store/engineRef';
import { useLayout } from '@/store/layout';
import { me, useMotionEditor, type ChannelRef } from '@/store/motionEditor';
import { commit, selectedRefs, setSelection } from './actions';
import { dopeProbe } from './view';

const PRESETS: { id: CurvePreset; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'ease-in', label: 'Ease in' },
  { id: 'ease-out', label: 'Ease out' },
  { id: 'ease-in-out', label: 'Ease in-out' },
  { id: 'step', label: 'Step' },
];

let dragSeq = 0;

function clipFor(ch: ChannelRef): MotionClip | null {
  const s = me.get();
  if (ch.kind === 'camera') return s.camera;
  return s.modelId ? (s.clips[s.modelId] ?? null) : null;
}

const targetFor = (ch: ChannelRef): string =>
  ch.kind === 'camera' ? CAMERA_TRACK : (me.get().modelId ?? '');

/** The key the curve box edits: last selected key of this track, else the next key at/after the playhead. */
function activeKeyFrame(ch: ChannelRef, clip: MotionClip): number | null {
  const frames = trackKeyFrames(clip, ch.kind, ch.track);
  if (!frames.length) return null;
  const sel = [...me.get().selection]
    .map(parseKeyId)
    .filter((r) => r.kind === ch.kind && r.track === ch.track);
  if (sel.length) return sel[sel.length - 1].f;
  const now = engineOrNull()?.getPlayback().frame ?? 0;
  return frames.find((f) => f >= now) ?? frames[frames.length - 1];
}

/** Graph editor: value curves of the active track (Euler display for rotations) + the VMD bezier box. */
export default function GraphEditor() {
  const channel = useMotionEditor((s) => s.channel);
  const revision = useMotionEditor((s) => s.revision);
  useMotionEditor((s) => s.selection);
  const coarse = useLayout((s) => s.coarse);
  const narrow = useLayout((s) => s.mode === 'phone' || s.mode === 'phone-landscape');
  const modelId = useMotionEditor((s) => s.modelId);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [allChannels, setAllChannels] = useState(false);

  const defs = useMemo(() => (channel ? channelDefs(channel.kind) : []), [channel]);
  const clip = channel ? clipFor(channel) : null;
  // Re-rendered on every edit (revision) and selection change; cheap to recompute.
  const activeF = channel && clip ? activeKeyFrame(channel, clip) : null;
  const curveCh = channel ? (channel.kind === 'morph' ? -1 : channel.channel) : -1;
  const bytes =
    channel && clip && activeF !== null
      ? keyCurve(clip, channel.kind, channel.track, activeF, curveCh)
      : null;
  const values =
    channel && clip && activeF !== null
      ? sampleChannels(clip, channel.kind, channel.track, [activeF]).values.map((v) => v[0])
      : [];

  /** Keys the curve tools act on: the selection, or the active key. */
  const curveRefs = (): KeyRef[] => {
    const sel = selectedRefs().filter((r) => r.kind !== 'morph');
    if (sel.length) return sel;
    return channel && activeF !== null && channel.kind !== 'morph'
      ? [{ kind: channel.kind, track: channel.track, f: activeF }]
      : [];
  };

  const writeCurve = (b: number[], key?: string): void => {
    const refs = curveRefs();
    if (!refs.length) return;
    const cam = refs.filter((r) => r.kind === 'camera');
    const bones = refs.filter((r) => r.kind === 'bone');
    const ch = allChannels ? null : curveCh;
    // Camera curves have 6 channels; bone curves 4 — a camera-only channel never applies to bones.
    if (bones.length && me.get().modelId && (ch === null || ch < 4))
      commit(me.get().modelId!, 'Edit curve', (c) => setCurves(c, bones, ch, b), key && `${key}-m`);
    if (cam.length) commit(CAMERA_TRACK, 'Edit curve', (c) => setCurves(c, cam, ch, b), key && `${key}-c`);
  };

  const setValue = (channelIdx: number, v: number): void => {
    if (!channel || activeF === null || !Number.isFinite(v)) return;
    commit(targetFor(channel), 'Edit key value', (c) =>
      setChannelValue(c, channel.kind, channel.track, activeF, channelIdx, v),
    );
  };

  if (!channel) {
    return (
      <div
        className="grid h-full place-items-center p-3 text-center text-[12px] text-fg-muted"
        data-testid="graph-editor"
      >
        Select a track or key in the dope sheet to edit its curves.
      </div>
    );
  }

  const side = (
    <div
      className={cn(
        'flex shrink-0 flex-col gap-2 overflow-y-auto border-line p-2 text-[11px]',
        narrow ? 'max-h-[38%] border-b' : 'border-r',
      )}
      style={narrow ? undefined : { width: coarse ? 132 : 172 }}
    >
      <div className="flex min-w-0 items-baseline font-medium text-fg">
        {channel.kind === 'camera' ? (
          'Camera'
        ) : (
          <NameLabel modelId={modelId} kind={channel.kind} ja={channel.track} />
        )}
        {activeF !== null && <span className="ml-1 font-mono text-fg-dim">@{activeF}</span>}
      </div>
      <div className={cn('gap-1', narrow ? 'grid grid-cols-2' : 'flex flex-col')}>
        {defs.map((d, i) => (
          <div key={d.id} className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={!hidden[d.id]}
              onClick={() => setHidden((h) => ({ ...h, [d.id]: !h[d.id] }))}
              className="h-3 w-3 shrink-0 rounded-sm border coarse:h-5 coarse:w-5"
              style={{ background: hidden[d.id] ? 'transparent' : d.color, borderColor: d.color }}
              title={`Show ${d.label}`}
            />
            <button
              type="button"
              onClick={() => d.curve >= 0 && me.set({ channel: { ...channel, channel: d.curve } })}
              className={cn(
                'w-14 shrink-0 truncate text-left',
                d.curve === curveCh ? 'text-fg' : 'text-fg-muted',
              )}
              title="Edit this channel's interpolation curve"
            >
              {d.label}
            </button>
            <input
              key={`${activeF}-${revision}-${d.id}`}
              aria-label={d.label}
              type="number"
              step={d.angle ? 1 : 0.1}
              defaultValue={values[i] !== undefined ? +values[i].toFixed(3) : ''}
              disabled={activeF === null}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              onBlur={(e) => {
                const v = parseFloat(e.target.value);
                if (values[i] === undefined || Math.abs(v - values[i]) < 1e-6) return;
                setValue(i, v);
              }}
              className="input h-6 w-full min-w-0 px-1 font-mono text-[11px] coarse:h-9"
            />
          </div>
        ))}
      </div>
      {channel.kind !== 'morph' && (
        <label className="flex items-center gap-1 text-fg-muted">
          <input type="checkbox" checked={allChannels} onChange={(e) => setAllChannels(e.target.checked)} />
          All channels
        </label>
      )}
    </div>
  );

  return (
    <div
      className={cn('flex h-full min-h-0 select-none', narrow ? 'flex-col' : 'flex-row')}
      data-testid="graph-editor"
    >
      {narrow && (
        <div className="flex shrink-0 justify-end border-b border-line p-1">
          <button type="button" className="btn" onClick={() => me.set({ graphOpen: false })}>
            Done
          </button>
        </div>
      )}
      {side}
      <div className={cn('relative flex min-h-0 min-w-0 flex-1', narrow && 'flex-col')}>
        <ValueGraph channel={channel} hidden={hidden} activeF={activeF} />
        {channel.kind !== 'morph' && (
          <div
            className={cn(
              'flex shrink-0 gap-2 border-line bg-bg-panel p-2 text-[11px]',
              narrow ? 'border-t' : 'w-[260px] border-l',
            )}
          >
            <div className={cn('shrink-0', narrow ? 'w-[110px]' : 'w-[120px]')}>
              <CurveBox bytes={bytes} onChange={writeCurve} />
            </div>
            <div
              className={cn('gap-1', narrow ? 'grid flex-1 grid-cols-2 content-start' : 'flex flex-col')}
              role="group"
              aria-label="Curve presets"
            >
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`preset-${p.id}`}
                  onClick={() => writeCurve(CURVE_PRESETS[p.id])}
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-left coarse:min-h-[44px] coarse:px-2.5',
                    bytes && presetOf(bytes, 0) === p.id
                      ? 'border-accent text-fg'
                      : 'border-line text-fg-muted hover:text-fg',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The VMD interpolation box: two control points in a unit square (bytes 0–127). */
function CurveBox({
  bytes,
  onChange,
}: {
  bytes: number[] | null;
  onChange: (b: number[], key?: string) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ handle: 0 | 1; key: string } | null>(null);
  const size = 127;
  const b = bytes ?? CURVE_PRESETS.linear;
  const path = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = i / 40;
      const y = bezierWeight(b[0] / 127, b[2] / 127, b[1] / 127, b[3] / 127, x);
      pts.push(`${(x * size).toFixed(1)},${((1 - y) * size).toFixed(1)}`);
    }
    return `M${pts.join('L')}`;
  }, [b]);

  const toBytes = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    const pad = 8 * (r.width / (size + 16));
    const x = ((e.clientX - r.left - pad) / (r.width - 2 * pad)) * 127;
    const y = (1 - (e.clientY - r.top - pad) / (r.height - 2 * pad)) * 127;
    return [Math.max(0, Math.min(127, Math.round(x))), Math.max(0, Math.min(127, Math.round(y)))];
  };
  const onDown = (handle: 0 | 1) => (e: React.PointerEvent) => {
    if (!bytes) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { handle, key: `curve-${++dragSeq}` };
  };
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d || !bytes) return;
    const [x, y] = toBytes(e);
    const next = [...bytes];
    next[d.handle * 2] = x;
    next[d.handle * 2 + 1] = y;
    onChange(next, d.key);
  };
  const handle = (i: 0 | 1, color: string) => (
    <g>
      <line
        x1={i ? size : 0}
        y1={i ? 0 : size}
        x2={b[i * 2]}
        y2={size - b[i * 2 + 1]}
        stroke={color}
        strokeWidth={1}
        opacity={0.6}
      />
      <circle
        cx={b[i * 2]}
        cy={size - b[i * 2 + 1]}
        r={7}
        fill={color}
        className="cursor-grab"
        data-testid={`curve-handle-${i + 1}`}
        onPointerDown={onDown(i)}
      />
    </g>
  );
  return (
    <svg
      ref={ref}
      viewBox={`-8 -8 ${size + 16} ${size + 16}`}
      className={cn(
        'w-full max-w-[160px] touch-none select-none rounded border border-line bg-bg',
        !bytes && 'opacity-40',
      )}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      role="img"
      aria-label={bytes ? `Curve ${bytes.join(' ')}` : 'No key'}
      data-testid="curve-box"
    >
      <rect x={0} y={0} width={size} height={size} fill="none" stroke="currentColor" className="text-line" />
      <line
        x1={0}
        y1={size}
        x2={size}
        y2={0}
        stroke="currentColor"
        className="text-line"
        strokeDasharray="3 3"
      />
      <path d={path} fill="none" stroke="#6d8bff" strokeWidth={2} />
      {handle(0, '#ff8a65')}
      {handle(1, '#81c784')}
    </svg>
  );
}

interface GraphView {
  width: number;
  height: number;
  start: number;
  ppf: number;
  vmin: number;
  vmax: number;
}

function ValueGraph({
  channel,
  hidden,
  activeF,
}: {
  channel: ChannelRef;
  hidden: Record<string, boolean>;
  activeF: number | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const view = useRef<GraphView>({ width: 400, height: 150, start: 0, ppf: 2, vmin: -1, vmax: 1 });
  const keysRef = useRef<{ x: number; y: number; f: number; c: number; v: number }[]>([]);
  const drag = useRef<{ f: number; c: number; key: string; y0: number; v0: number; scale: number } | null>(
    null,
  );
  const queued = useRef(false);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const activeRef = useRef(activeF);
  activeRef.current = activeF;

  const draw = useCallback(() => {
    queued.current = false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const s = me.get();
    const g = view.current;
    g.start = s.view.start;
    g.ppf = dopeProbe.ppf ?? Math.max(0.05, g.width / Math.max(1, s.view.span));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(g.width * dpr) || canvas.height !== Math.round(g.height * dpr)) {
      canvas.width = Math.round(g.width * dpr);
      canvas.height = Math.round(g.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101218';
    ctx.fillRect(0, 0, g.width, g.height);
    const clip = clipFor(channel);
    if (!clip) return;
    const defs = channelDefs(channel.kind);
    const end = g.start + g.width / g.ppf;
    const step = Math.max(0.25, 2 / g.ppf);
    const frames: number[] = [];
    for (let f = Math.max(0, Math.floor(g.start)); f <= end; f += step) frames.push(f);
    const keyFrames = trackKeyFrames(clip, channel.kind, channel.track);
    // Key frames are sampled in the same pass so angle unwrapping is consistent.
    const all = [...new Set([...frames, ...keyFrames.filter((f) => f >= g.start - 1 && f <= end + 1)])].sort(
      (a, b) => a - b,
    );
    if (!all.length) return;
    const series = sampleChannels(clip, channel.kind, channel.track, all);
    const visible = defs.map((d) => !hiddenRef.current[d.id]);
    // Fit the value range to the visible curves (not while dragging, so the key stays under the pointer).
    if (!drag.current) {
      let lo = Infinity;
      let hi = -Infinity;
      series.values.forEach((vals, c) => {
        if (!visible[c]) return;
        for (const v of vals) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      });
      if (!Number.isFinite(lo)) [lo, hi] = [-1, 1];
      const pad = Math.max(0.5, (hi - lo) * 0.12);
      g.vmin = lo - pad;
      g.vmax = hi + pad;
    }
    const vy = (v: number): number => g.height - 6 - ((v - g.vmin) / (g.vmax - g.vmin)) * (g.height - 12);
    const fx = (f: number): number => (f - g.start) * g.ppf;
    // Grid: zero line + horizontal ticks.
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const range = g.vmax - g.vmin;
    const tick = Math.pow(10, Math.floor(Math.log10(range / 4)));
    const tstep = [1, 2, 5, 10].map((m) => m * tick).find((t) => range / t <= 6) ?? tick * 10;
    for (let v = Math.ceil(g.vmin / tstep) * tstep; v <= g.vmax; v += tstep) {
      const y = Math.round(vy(v)) + 0.5;
      ctx.fillStyle = Math.abs(v) < tstep / 2 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, y, g.width, 1);
      ctx.fillStyle = '#6b7280';
      ctx.fillText(+v.toFixed(3) + '', 4, y - 6);
    }
    for (const f of keyFrames) {
      if (f < g.start || f > end) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(Math.round(fx(f)), 0, 1, g.height);
    }
    // Curves.
    const sel = me.get().selection;
    const keys: typeof keysRef.current = [];
    defs.forEach((d, c) => {
      if (!visible[c]) return;
      const active = d.curve === channel.channel || channel.kind === 'morph';
      ctx.strokeStyle = d.color;
      ctx.globalAlpha = active ? 1 : 0.55;
      ctx.lineWidth = active ? 1.75 : 1;
      ctx.beginPath();
      series.frames.forEach((f, i) => {
        const x = fx(f);
        const y = vy(series.values[c][i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
      for (const f of keyFrames) {
        if (f < g.start - 1 || f > end + 1) continue;
        const i = series.frames.indexOf(f);
        if (i < 0) continue;
        const x = fx(f);
        const y = vy(series.values[c][i]);
        const on = sel.has(keyId({ kind: channel.kind, track: channel.track, f })) || f === activeRef.current;
        ctx.fillStyle = on ? '#ffffff' : d.color;
        ctx.strokeStyle = '#101218';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, on ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        keys.push({ x, y, f, c, v: series.values[c][i] });
      }
    });
    keysRef.current = keys;
  }, [channel]);

  const requestDraw = useCallback(() => {
    if (queued.current) return;
    queued.current = true;
    requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    requestDraw();
  }, [hidden, activeF, requestDraw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      view.current.width = wrap.clientWidth;
      view.current.height = wrap.clientHeight;
      requestDraw();
    });
    ro.observe(wrap);
    const unsub = useMotionEditor.subscribe(requestDraw);
    return () => {
      ro.disconnect();
      unsub();
    };
  }, [requestDraw]);

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const head = headRef.current;
      const engine = engineOrNull();
      if (!head || !engine) return;
      const x = (engine.getPlayback().frame - view.current.start) * view.current.ppf;
      head.style.transform = `translateX(${x}px)`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const local = (e: React.PointerEvent): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent): void => {
    const p = local(e);
    const r = e.pointerType === 'touch' ? 16 : 7;
    let best: (typeof keysRef.current)[number] | null = null;
    let bd = r * r;
    for (const k of keysRef.current) {
      const d = (k.x - p.x) ** 2 + (k.y - p.y) ** 2;
      if (d <= bd) {
        bd = d;
        best = k;
      }
    }
    if (!best) {
      const g = view.current;
      engineOrNull()?.seek(Math.max(0, Math.round(g.start + p.x / g.ppf)));
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const id = keyId({ kind: channel.kind, track: channel.track, f: best.f });
    const sel = new Set(me.get().selection);
    if (e.shiftKey) sel.add(id);
    else if (!sel.has(id)) {
      sel.clear();
      sel.add(id);
    }
    setSelection(sel);
    const def = channelDefs(channel.kind)[best.c];
    if (def.curve >= 0 && def.curve !== channel.channel)
      me.set({ channel: { ...channel, channel: def.curve } });
    const g = view.current;
    drag.current = {
      f: best.f,
      c: best.c,
      key: `value-${++dragSeq}`,
      y0: p.y,
      v0: best.v,
      scale: (g.vmax - g.vmin) / Math.max(1, g.height - 12),
    };
  };

  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const p = local(e);
    const fine = e.shiftKey ? 0.1 : 1;
    const v = d.v0 - (p.y - d.y0) * d.scale * fine;
    const clip = clipFor(channel);
    if (!clip) return;
    commit(
      targetFor(channel),
      'Edit key value',
      (c) => setChannelValue(c, channel.kind, channel.track, d.f, d.c, v),
      d.key,
    );
  };

  const onUp = (): void => {
    if (drag.current) {
      drag.current = null;
      requestDraw();
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative min-h-[120px] min-w-0 flex-1 overflow-hidden"
      data-testid="graph-canvas"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      <div
        ref={headRef}
        className="pointer-events-none absolute inset-y-0 left-0 w-px bg-accent"
        aria-hidden
      />
    </div>
  );
}
