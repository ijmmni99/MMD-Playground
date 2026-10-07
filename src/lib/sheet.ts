import type { SheetSnap } from '@/store/layout';

export type OpenSnap = Exclude<SheetSnap, 'closed'>;
export const SNAP_ORDER: OpenSnap[] = ['peek', 'half', 'full'];

export interface SnapHeights {
  peek: number;
  half: number;
  full: number;
}

/** Sheet heights (px) for an available container height. */
export function snapHeights(available: number, peek = 156): SnapHeights {
  const full = Math.max(peek + 40, Math.round(available - 8));
  const half = Math.min(full, Math.max(peek + 40, Math.round(available * 0.52)));
  return { peek: Math.min(peek, full), half, full };
}

/** px/ms; faster than this counts as a fling. */
export const FLING_VELOCITY = 0.5;

/**
 * Decide where a released sheet should settle.
 * @param height current sheet height in px
 * @param velocity px/ms, positive = moving up (growing)
 */
export function resolveSnap(height: number, velocity: number, h: SnapHeights): SheetSnap {
  // Flings move one step in the fling direction (or dismiss from peek).
  if (Math.abs(velocity) > FLING_VELOCITY) {
    if (velocity > 0) return SNAP_ORDER.find((s) => h[s] > height + 1) ?? 'full';
    return [...SNAP_ORDER].reverse().find((s) => h[s] < height - 1) ?? 'closed';
  }
  // Slow release: dismiss if pulled well below peek, otherwise nearest snap.
  if (height < h.peek * 0.6) return 'closed';
  let best: OpenSnap = 'peek';
  for (const s of SNAP_ORDER) if (Math.abs(h[s] - height) < Math.abs(h[best] - height)) best = s;
  return best;
}

/** Clamp a dragged height with rubber-banding beyond full. */
export function clampDrag(height: number, h: SnapHeights): number {
  if (height > h.full) return h.full + (height - h.full) * 0.25;
  return Math.max(0, height);
}
