import { describe, expect, it } from 'vitest';
import { clampDrag, FLING_VELOCITY, resolveSnap, snapHeights } from './sheet';

const h = snapHeights(700);

describe('bottom sheet snapping', () => {
  it('computes ordered snap heights', () => {
    expect(h.peek).toBeLessThan(h.half);
    expect(h.half).toBeLessThan(h.full);
    expect(h.full).toBe(692);
  });

  it('keeps snaps sane on tiny containers', () => {
    const t = snapHeights(120);
    expect(t.peek).toBeLessThanOrEqual(t.half);
    expect(t.half).toBeLessThanOrEqual(t.full);
  });

  it('settles on the nearest snap after a slow release', () => {
    expect(resolveSnap(h.half + 20, 0, h)).toBe('half');
    expect(resolveSnap(h.full - 30, 0.1, h)).toBe('full');
    expect(resolveSnap(h.peek + 10, -0.1, h)).toBe('peek');
  });

  it('dismisses when pulled well below peek', () => {
    expect(resolveSnap(h.peek * 0.4, 0, h)).toBe('closed');
  });

  it('flings one step in the fling direction', () => {
    const fast = FLING_VELOCITY + 0.5;
    expect(resolveSnap(h.peek + 5, fast, h)).toBe('half');
    expect(resolveSnap(h.half + 5, fast, h)).toBe('full');
    expect(resolveSnap(h.half - 5, -fast, h)).toBe('peek');
    expect(resolveSnap(h.peek - 5, -fast, h)).toBe('closed');
    expect(resolveSnap(h.full, fast, h)).toBe('full');
  });

  it('rubber-bands beyond full height', () => {
    expect(clampDrag(h.full + 100, h)).toBe(h.full + 25);
    expect(clampDrag(-20, h)).toBe(0);
    expect(clampDrag(300, h)).toBe(300);
  });
});
