import { useCallback, useEffect, useRef } from 'react';
import { beatFrames, snapFrame } from '@/lib/motion/timing';
import { keyId, type KeyRef } from '@/lib/motion/types';
import { engineOrNull } from '@/store/engineRef';
import { useLayout } from '@/store/layout';
import { me, useMotionEditor } from '@/store/motionEditor';
import { beginKeyDrag, endKeyDrag, selectGroup, setSelection, updateKeyDrag } from './actions';
import { buildRows, GROUP_COLOR, type Row } from './rows';
import { dopeProbe } from './view';

const RULER_H = 22;
const SHOT_H = 14;
const HEADER_H = RULER_H + SHOT_H;

const labelWidth = (coarse: boolean): number => (coarse ? 132 : 172);
const rowHeight = (coarse: boolean): number => (coarse ? 34 : 20);

interface Geometry {
  width: number;
  height: number;
  labelW: number;
  rowH: number;
  start: number;
  ppf: number;
  scrollY: number;
}

const frameToX = (g: Geometry, f: number): number => g.labelW + (f - g.start) * g.ppf;
const xToFrame = (g: Geometry, x: number): number => g.start + (x - g.labelW) / g.ppf;

function rulerStep(ppf: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 150, 300, 600, 1800];
  return steps.find((s) => s * ppf >= 48) ?? 3600;
}

/** First index in a sorted list with value ≥ v. */
function lowerBound(a: readonly number[], v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Canvas dope sheet: rows per group/track, keyframe diamonds, markers, shots, pins and the playhead. */
export function DopeSheet() {
  const coarse = useLayout((s) => s.coarse);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const geo = useRef<Geometry>({
    width: 600,
    height: 200,
    labelW: 172,
    rowH: 20,
    start: 0,
    ppf: 2,
    scrollY: 0,
  });
  const rowsRef = useRef<Row[]>([]);
  const box = useRef<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(null);
  const drawQueued = useRef(false);

  const computeRows = useCallback((): Row[] => {
    const s = me.get();
    const clip = s.modelId ? (s.clips[s.modelId] ?? null) : null;
    return buildRows(clip, s.camera, s.collapsed, s.modelId ? s.pins[s.modelId] : []);
  }, []);

  const draw = useCallback(() => {
    drawQueued.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = me.get();
    const g = geo.current;
    g.labelW = labelWidth(coarse);
    g.rowH = rowHeight(coarse);
    g.start = s.view.start;
    g.ppf = Math.max(0.05, (g.width - g.labelW) / Math.max(1, s.view.span));
    dopeProbe.ppf = g.ppf;
    const rows = (rowsRef.current = computeRows());
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(g.width * dpr) || canvas.height !== Math.round(g.height * dpr)) {
      canvas.width = Math.round(g.width * dpr);
      canvas.height = Math.round(g.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(canvas);
    const col = (v: string, fb: string): string => css.getPropertyValue(v).trim() || fb;
    const bg = col('--me-bg', '#13151b');
    const line = col('--me-line', '#262a33');
    const text = col('--me-text', '#c7ccd8');
    const dim = col('--me-dim', '#8b93a7');
    const accent = '#6d8bff';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, g.width, g.height);
    const end = xToFrame(g, g.width);
    const font = coarse ? 13 : 11;
    ctx.font = `${font}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';

    // Beat grid + bar lines.
    if (s.grid.bpm > 0) {
      for (const b of beatFrames(s.grid, Math.max(0, g.start), end)) {
        const x = frameToX(g, b.f);
        ctx.fillStyle = b.bar ? 'rgba(109,139,255,0.22)' : 'rgba(109,139,255,0.09)';
        ctx.fillRect(Math.round(x), HEADER_H, 1, g.height - HEADER_H);
      }
    }

    // Rows.
    const first = Math.max(0, Math.floor(g.scrollY / g.rowH));
    const visible = Math.ceil((g.height - HEADER_H) / g.rowH) + 1;
    for (let i = first; i < Math.min(rows.length, first + visible); i++) {
      const r = rows[i];
      const y = HEADER_H + i * g.rowH - g.scrollY;
      if (r.type === 'group') {
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(0, y, g.width, g.rowH);
      }
      ctx.fillStyle = line;
      ctx.fillRect(0, y + g.rowH - 1, g.width, 1);
      // Pins (lock ranges) on IK rows.
      if (r.type === 'track' && r.pins) {
        for (const p of r.pins) {
          const xa = frameToX(g, p.start - p.blendIn);
          const xs = frameToX(g, p.start);
          const xe = frameToX(g, p.end);
          const xb = frameToX(g, p.end + p.blendOut);
          ctx.fillStyle = 'rgba(255,138,101,0.12)';
          ctx.fillRect(xa, y + 2, xs - xa, g.rowH - 4);
          ctx.fillRect(xe, y + 2, xb - xe, g.rowH - 4);
          ctx.fillStyle = 'rgba(255,138,101,0.32)';
          ctx.fillRect(xs, y + 2, Math.max(2, xe - xs), g.rowH - 4);
          ctx.fillStyle = '#ffccbc';
          ctx.fillText('🔒', Math.max(g.labelW + 2, xs + 2), y + g.rowH / 2);
        }
      }
      // Keys.
      const frames = r.frames;
      const color = r.type === 'group' ? GROUP_COLOR[r.id] : GROUP_COLOR[r.group];
      const size = r.type === 'group' ? (coarse ? 4 : 3) : coarse ? 7 : 5;
      for (let k = lowerBound(frames, g.start - 1); k < frames.length && frames[k] <= end + 1; k++) {
        const f = frames[k];
        const x = frameToX(g, f);
        if (x < g.labelW - size) continue;
        const selected = r.type === 'track' && s.selection.has(keyId({ kind: r.kind, track: r.track, f }));
        ctx.fillStyle = selected ? '#ffffff' : color;
        ctx.beginPath();
        ctx.moveTo(x, y + g.rowH / 2 - size);
        ctx.lineTo(x + size, y + g.rowH / 2);
        ctx.lineTo(x, y + g.rowH / 2 + size);
        ctx.lineTo(x - size, y + g.rowH / 2);
        ctx.closePath();
        ctx.fill();
        if (selected) {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      // Label column.
      ctx.fillStyle = bg;
      ctx.fillRect(0, y, g.labelW, g.rowH - 1);
      if (r.type === 'group') {
        ctx.fillStyle = color;
        ctx.fillRect(4, y + 4, 3, g.rowH - 8);
        ctx.fillStyle = text;
        ctx.fillText(`${r.collapsed ? '▸' : '▾'} ${r.label} (${r.count})`, 12, y + g.rowH / 2);
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(18, y + g.rowH / 2, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = dim;
        const label = r.label.length > 16 ? `${r.label.slice(0, 15)}…` : r.label;
        ctx.fillText(label, 26, y + g.rowH / 2);
      }
    }

    // Header: ruler + shots lane.
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, g.width, HEADER_H);
    ctx.fillStyle = line;
    ctx.fillRect(0, RULER_H - 1, g.width, 1);
    ctx.fillRect(0, HEADER_H - 1, g.width, 1);
    ctx.fillRect(g.labelW - 1, 0, 1, g.height);
    const step = rulerStep(g.ppf);
    ctx.fillStyle = dim;
    ctx.font = `${coarse ? 12 : 10}px ui-monospace, monospace`;
    for (let f = Math.ceil(Math.max(0, g.start) / step) * step; f <= end; f += step) {
      const x = frameToX(g, f);
      if (x < g.labelW) continue;
      ctx.fillRect(Math.round(x), RULER_H - 7, 1, 6);
      ctx.fillText(String(f), x + 3, RULER_H / 2);
    }
    if (s.range) {
      const xa = Math.max(g.labelW, frameToX(g, s.range[0]));
      const xb = frameToX(g, s.range[1] + 1);
      if (xb > xa) {
        ctx.fillStyle = 'rgba(255,213,79,0.28)';
        ctx.fillRect(xa, 0, xb - xa, RULER_H - 1);
        ctx.fillStyle = 'rgba(255,213,79,0.05)';
        ctx.fillRect(xa, HEADER_H, xb - xa, g.height - HEADER_H);
      }
    }
    for (const sh of s.shots) {
      const xa = Math.max(g.labelW, frameToX(g, sh.start));
      const xb = frameToX(g, sh.end + 1);
      if (xb < g.labelW) continue;
      ctx.fillStyle = sh.color;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(xa, RULER_H + 1, Math.max(2, xb - xa - 1), SHOT_H - 3);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#111';
      ctx.font = `600 ${coarse ? 11 : 9}px Inter, sans-serif`;
      ctx.fillText(`${sh.transition === 'cut' ? '✂ ' : ''}${sh.name}`, xa + 3, RULER_H + SHOT_H / 2 - 1);
    }
    for (const m of s.markers) {
      const x = frameToX(g, m.f);
      if (x < g.labelW) continue;
      ctx.fillStyle = '#ffd54f';
      ctx.fillRect(Math.round(x), 0, 1, g.height);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 6, 0);
      ctx.lineTo(x, 7);
      ctx.fill();
      ctx.font = `${coarse ? 12 : 10}px Inter, sans-serif`;
      ctx.fillText(m.name, x + 4, 12);
    }
    ctx.fillStyle = text;
    ctx.font = `600 ${coarse ? 12 : 10}px Inter, sans-serif`;
    ctx.fillText(s.modelId ? 'Tracks' : 'Camera', 8, RULER_H / 2);
    ctx.fillStyle = dim;
    ctx.fillText('Shots', 8, RULER_H + SHOT_H / 2);

    // Box selection.
    const b = box.current;
    if (b) {
      ctx.fillStyle = 'rgba(109,139,255,0.15)';
      ctx.strokeStyle = accent;
      const x = Math.min(b.x0, b.x1);
      const y = Math.min(b.y0, b.y1);
      ctx.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
  }, [coarse, computeRows]);

  const requestDraw = useCallback(() => {
    if (drawQueued.current) return;
    drawQueued.current = true;
    requestAnimationFrame(draw);
  }, [draw]);

  // Size + store subscription.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      geo.current.width = wrap.clientWidth;
      geo.current.height = wrap.clientHeight;
      requestDraw();
    });
    ro.observe(wrap);
    const unsub = useMotionEditor.subscribe(requestDraw);
    requestDraw();
    return () => {
      ro.disconnect();
      unsub();
    };
  }, [requestDraw]);

  // Probe for automation: where a key is drawn (scrolls the row into view first).
  useEffect(() => {
    dopeProbe.keyPoint = (track, f) => {
      const g = geo.current;
      const i = rowsRef.current.findIndex((r) => r.type === 'track' && r.track === track);
      const canvas = canvasRef.current;
      if (i < 0 || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const y = HEADER_H + i * g.rowH - g.scrollY + g.rowH / 2;
      if (y < HEADER_H || y > g.height) return null;
      return { x: rect.left + frameToX(g, f), y: rect.top + y };
    };
    return () => {
      dopeProbe.keyPoint = undefined;
    };
  }, []);

  // Playhead via rAF (no React state).
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const head = headRef.current;
      const engine = engineOrNull();
      if (!head || !engine) return;
      const x = frameToX(geo.current, engine.getPlayback().frame);
      head.style.transform = `translateX(${x}px)`;
      head.style.opacity = x < geo.current.labelW ? '0' : '1';
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------------------------------------------------------------- interaction
  const hitRow = (y: number): number => Math.floor((y - HEADER_H + geo.current.scrollY) / geo.current.rowH);

  const hitKey = (x: number, y: number): KeyRef | null => {
    const g = geo.current;
    const r = rowsRef.current[hitRow(y)];
    if (!r || r.type !== 'track') return null;
    const f = Math.round(xToFrame(g, x));
    const tol = Math.max(1, Math.ceil((coarse ? 14 : 7) / g.ppf));
    let best: number | null = null;
    for (let d = 0; d <= tol; d++) {
      for (const c of d ? [f - d, f + d] : [f]) {
        if (r.frames[lowerBound(r.frames, c)] === c) {
          best = c;
          break;
        }
      }
      if (best !== null) break;
    }
    return best === null ? null : { kind: r.kind, track: r.track, f: best };
  };

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { type: 'scrub' }
    | { type: 'range'; from: number }
    | { type: 'drag'; startX: number; anchor: number; moved: boolean }
    | { type: 'box' }
    | { type: 'pinch'; dist: number; mid: number; start: number; span: number }
    | null
  >(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  const local = (e: React.PointerEvent | React.WheelEvent): { x: number; y: number } => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const seekTo = (x: number): void => {
    const s = me.get();
    const f = snapFrame(xToFrame(geo.current, x), {
      grid: s.snapToBeats ? s.grid : undefined,
      markers: s.markers,
      radius: s.snapToBeats ? 1.5 : 0,
    });
    engineOrNull()?.seek(f);
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    const p = local(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const s = me.get();
      gesture.current = {
        type: 'pinch',
        dist: Math.abs(a.x - b.x) || 1,
        mid: (a.x + b.x) / 2,
        start: s.view.start,
        span: s.view.span,
      };
      box.current = null;
      if (longPress.current) clearTimeout(longPress.current);
      return;
    }
    const g = geo.current;
    if (p.y < HEADER_H) {
      if (e.shiftKey && p.x > g.labelW) {
        // Shift-drag on the ruler: set the tool range.
        const from = Math.max(0, Math.round(xToFrame(g, p.x)));
        gesture.current = { type: 'range', from };
        me.set({ range: [from, from] });
        return;
      }
      if (e.altKey) {
        me.set({ range: null });
        return;
      }
      gesture.current = { type: 'scrub' };
      if (p.x > g.labelW) seekTo(p.x);
      return;
    }
    const row = rowsRef.current[hitRow(p.y)];
    if (p.x < g.labelW) {
      if (!row) return;
      if (row.type === 'group') {
        me.set((s) => ({ collapsed: { ...s.collapsed, [row.id]: !s.collapsed[row.id] } }));
      } else {
        const ids = row.frames.map((f) => keyId({ kind: row.kind, track: row.track, f }));
        setSelection(e.shiftKey ? [...me.get().selection, ...ids] : ids);
        me.set({ channel: { kind: row.kind, track: row.track, channel: row.kind === 'morph' ? 0 : 3 } });
      }
      return;
    }
    const hit = hitKey(p.x, p.y);
    if (hit) {
      const id = keyId(hit);
      const sel = new Set(me.get().selection);
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (sel.has(id)) sel.delete(id);
        else sel.add(id);
        setSelection(sel);
      } else if (!sel.has(id)) setSelection([id]);
      me.set({ channel: { kind: hit.kind, track: hit.track, channel: hit.kind === 'morph' ? 0 : 3 } });
      gesture.current = { type: 'drag', startX: p.x, anchor: hit.f, moved: false };
      if (e.pointerType === 'touch') {
        longPress.current = setTimeout(() => {
          // Long-press: add/remove from the selection (touch multi-select).
          const s2 = new Set(me.get().selection);
          if (s2.has(id) && s2.size > 1) s2.delete(id);
          else s2.add(id);
          setSelection(s2);
          gesture.current = null;
        }, 450);
      }
      return;
    }
    if (row?.type === 'group' && e.detail >= 2) {
      selectGroup(row.id);
      return;
    }
    box.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey };
    gesture.current = { type: 'box' };
    requestDraw();
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const gst = gesture.current;
    if (!gst) return;
    if (gst.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.abs(a.x - b.x) || 1;
      const mid = (a.x + b.x) / 2;
      const span = Math.min(20000, Math.max(20, gst.span * (gst.dist / dist)));
      const g = geo.current;
      const ppf = (g.width - g.labelW) / span;
      const anchor = gst.start + (gst.mid - g.labelW) / ((g.width - g.labelW) / gst.span);
      me.set({ view: { span, start: Math.max(-10, anchor - (mid - g.labelW) / ppf) } });
      return;
    }
    if (gst.type === 'scrub') {
      seekTo(p.x);
      return;
    }
    if (gst.type === 'range') {
      const f = Math.max(0, Math.round(xToFrame(geo.current, p.x)));
      me.set({ range: [Math.min(gst.from, f), Math.max(gst.from, f)] });
      return;
    }
    if (gst.type === 'drag') {
      const dx = p.x - gst.startX;
      if (!gst.moved && Math.abs(dx) < 4) return;
      if (longPress.current) clearTimeout(longPress.current);
      if (!gst.moved) {
        gst.moved = true;
        beginKeyDrag();
      }
      const s = me.get();
      const target = snapFrame(gst.anchor + dx / geo.current.ppf, {
        grid: s.snapToBeats ? s.grid : undefined,
        markers: s.markers,
        radius: s.snapToBeats ? 2 : 0,
      });
      updateKeyDrag(target - gst.anchor, e.altKey);
      return;
    }
    if (gst.type === 'box' && box.current) {
      box.current.x1 = p.x;
      box.current.y1 = p.y;
      requestDraw();
    }
  };

  const onPointerUp = (e: React.PointerEvent): void => {
    pointers.current.delete(e.pointerId);
    if (longPress.current) clearTimeout(longPress.current);
    const gst = gesture.current;
    if (gst?.type === 'drag' && gst.moved) endKeyDrag(e.altKey ? 'Copy keys' : 'Move keys');
    if (gst?.type === 'box' && box.current) {
      const b = box.current;
      const g = geo.current;
      const f0 = xToFrame(g, Math.min(b.x0, b.x1));
      const f1 = xToFrame(g, Math.max(b.x0, b.x1));
      const r0 = hitRow(Math.min(b.y0, b.y1));
      const r1 = hitRow(Math.max(b.y0, b.y1));
      const ids: string[] = b.add ? [...me.get().selection] : [];
      const tiny = Math.abs(b.x1 - b.x0) < 3 && Math.abs(b.y1 - b.y0) < 3;
      if (!tiny) {
        for (let i = Math.max(0, r0); i <= Math.min(rowsRef.current.length - 1, r1); i++) {
          const r = rowsRef.current[i];
          if (r.type !== 'track') continue;
          for (const f of r.frames)
            if (f >= f0 && f <= f1) ids.push(keyId({ kind: r.kind, track: r.track, f }));
        }
      } else if (!b.add) {
        // A click on empty space: deselect and move the playhead.
        seekTo(b.x0);
      }
      setSelection(ids);
      box.current = null;
      requestDraw();
    }
    if (pointers.current.size === 0) gesture.current = null;
  };

  const onWheel = (e: React.WheelEvent): void => {
    const s = me.get();
    const g = geo.current;
    if (e.ctrlKey || e.metaKey) {
      const p = local(e);
      const anchor = xToFrame(g, p.x);
      const span = Math.min(20000, Math.max(20, s.view.span * Math.exp(e.deltaY * 0.0015)));
      const ppf = (g.width - g.labelW) / span;
      me.set({ view: { span, start: Math.max(-10, anchor - (p.x - g.labelW) / ppf) } });
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = (e.shiftKey ? e.deltaY : e.deltaX) / g.ppf;
      me.set({ view: { ...s.view, start: Math.max(-10, s.view.start + d) } });
    } else {
      const max = Math.max(0, rowsRef.current.length * g.rowH - (g.height - HEADER_H) + g.rowH);
      g.scrollY = Math.min(max, Math.max(0, g.scrollY + e.deltaY));
      requestDraw();
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative min-h-0 flex-1 overflow-hidden"
      data-testid="dope-sheet"
      style={
        {
          '--me-bg': 'rgb(19 21 27)',
          '--me-line': 'rgb(38 42 51)',
          '--me-text': 'rgb(199 204 216)',
          '--me-dim': 'rgb(139 147 167)',
        } as React.CSSProperties
      }
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none select-none"
        role="grid"
        aria-label="Dope sheet: keyframes per bone, morph and camera track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        ref={headRef}
        className="pointer-events-none absolute bottom-0 top-0 w-px bg-danger"
        style={{ left: 0 }}
        aria-hidden
      />
    </div>
  );
}
