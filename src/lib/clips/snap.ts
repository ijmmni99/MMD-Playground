import { framesPerBeat } from '@/lib/motion/timing';
import type { TimingGrid } from '@/lib/motion/types';
import { clipEnd, type Clip } from './types';

export interface SnapContext {
  playhead?: number;
  /** Other clips (their edges are snap points). */
  clips?: readonly Clip[];
  markers?: readonly number[];
  grid?: TimingGrid;
  /** Snap distance in frames. */
  radius: number;
}

/** Candidate frames near `f`. */
function candidates(ctx: SnapContext, f: number, exclude?: string): number[] {
  const out: number[] = [];
  if (ctx.playhead !== undefined) out.push(ctx.playhead);
  for (const c of ctx.clips ?? []) {
    if (c.id === exclude) continue;
    out.push(c.startFrame, clipEnd(c));
  }
  out.push(...(ctx.markers ?? []));
  if (ctx.grid && ctx.grid.bpm > 0) {
    const step = framesPerBeat(ctx.grid.bpm);
    out.push(ctx.grid.offset + Math.round((f - ctx.grid.offset) / step) * step);
  }
  return out;
}

/** Snap one frame to the nearest candidate within the radius (whole frames otherwise). */
export function snapPoint(
  f: number,
  ctx: SnapContext,
  exclude?: string,
): { frame: number; snapped: boolean } {
  let best = Math.round(f);
  let bestD = ctx.radius + 1e-9;
  let snapped = false;
  for (const c of candidates(ctx, f, exclude)) {
    const d = Math.abs(c - f);
    if (d <= bestD) {
      bestD = d;
      best = Math.round(c);
      snapped = true;
    }
  }
  return { frame: Math.max(0, best), snapped };
}

/** Snap a moving clip: whichever of its start or end edge is closer to a snap point wins. */
export function snapMove(
  start: number,
  length: number,
  ctx: SnapContext,
  exclude?: string,
): { start: number; snapped: boolean } {
  const a = snapPoint(start, ctx, exclude);
  const b = snapPoint(start + length, ctx, exclude);
  const da = a.snapped ? Math.abs(a.frame - start) : Infinity;
  const db = b.snapped ? Math.abs(b.frame - (start + length)) : Infinity;
  if (!a.snapped && !b.snapped) return { start: Math.max(0, Math.round(start)), snapped: false };
  return da <= db
    ? { start: a.frame, snapped: true }
    : { start: Math.max(0, b.frame - length), snapped: true };
}
