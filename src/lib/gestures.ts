export interface PointerSample {
  x: number;
  y: number;
  t: number;
}

export const TAP_MAX_MOVE = 10;
export const TAP_MAX_MS = 300;
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_DIST = 40;

export type TapResult = 'none' | 'tap' | 'double';

/**
 * Classifies single-pointer interactions as tap / double tap. Any multi-touch in between cancels
 * (pinches must never register as taps). Pure: feed it samples with timestamps.
 */
export class TapDetector {
  private down: PointerSample | null = null;
  private lastTap: PointerSample | null = null;
  private cancelled = false;
  private active = 0;

  pointerDown(p: PointerSample): void {
    this.active += 1;
    if (this.active > 1) {
      this.cancelled = true;
      this.lastTap = null;
      return;
    }
    this.cancelled = false;
    this.down = p;
  }

  pointerMove(p: PointerSample): void {
    if (this.down && Math.hypot(p.x - this.down.x, p.y - this.down.y) > TAP_MAX_MOVE) this.cancelled = true;
  }

  pointerUp(p: PointerSample): TapResult {
    this.active = Math.max(0, this.active - 1);
    const d = this.down;
    if (this.active > 0) return 'none';
    this.down = null;
    if (!d || this.cancelled) return 'none';
    if (p.t - d.t > TAP_MAX_MS || Math.hypot(p.x - d.x, p.y - d.y) > TAP_MAX_MOVE) return 'none';
    const prev = this.lastTap;
    if (prev && p.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(p.x - prev.x, p.y - prev.y) <= DOUBLE_TAP_DIST) {
      this.lastTap = null;
      return 'double';
    }
    this.lastTap = p;
    return 'tap';
  }

  pointerCancel(): void {
    this.active = 0;
    this.down = null;
    this.cancelled = true;
  }
}

export interface Point {
  x: number;
  y: number;
}

/** Distance and midpoint of two touch points. */
export function pinchState(a: Point, b: Point): { distance: number; center: Point } {
  return { distance: Math.hypot(a.x - b.x, a.y - b.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

/** Zoom factor between two pinch states (clamped to avoid jumps from near-zero distances). */
export function pinchScale(startDistance: number, distance: number): number {
  if (startDistance < 8) return 1;
  return Math.min(8, Math.max(0.125, distance / startDistance));
}

/** Index of the point closest to `p` within `radius`, or -1. */
export function nearestWithin(points: readonly (Point | null)[], p: Point, radius: number): number {
  let best = -1;
  let bestD = radius;
  points.forEach((q, i) => {
    if (!q) return;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
