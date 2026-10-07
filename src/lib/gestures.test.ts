import { describe, expect, it } from 'vitest';
import { nearestWithin, pinchScale, pinchState, TapDetector } from './gestures';

const p = (x: number, y: number, t: number) => ({ x, y, t });

describe('TapDetector', () => {
  it('recognises taps and double taps', () => {
    const d = new TapDetector();
    d.pointerDown(p(10, 10, 0));
    expect(d.pointerUp(p(12, 11, 100))).toBe('tap');
    d.pointerDown(p(14, 12, 250));
    expect(d.pointerUp(p(14, 12, 300))).toBe('double');
    // a third tap starts over
    d.pointerDown(p(14, 12, 400));
    expect(d.pointerUp(p(14, 12, 450))).toBe('tap');
  });

  it('ignores drags and long presses', () => {
    const d = new TapDetector();
    d.pointerDown(p(0, 0, 0));
    d.pointerMove(p(30, 0, 50));
    expect(d.pointerUp(p(30, 0, 80))).toBe('none');
    d.pointerDown(p(0, 0, 1000));
    expect(d.pointerUp(p(0, 0, 1600))).toBe('none');
  });

  it('never reports taps for multi-touch (pinch)', () => {
    const d = new TapDetector();
    d.pointerDown(p(0, 0, 0));
    d.pointerDown(p(100, 0, 10));
    expect(d.pointerUp(p(100, 0, 60))).toBe('none');
    expect(d.pointerUp(p(0, 0, 70))).toBe('none');
  });

  it('does not pair taps that are far apart in time or space', () => {
    const d = new TapDetector();
    d.pointerDown(p(0, 0, 0));
    expect(d.pointerUp(p(0, 0, 50))).toBe('tap');
    d.pointerDown(p(200, 200, 100));
    expect(d.pointerUp(p(200, 200, 150))).toBe('tap');
    d.pointerDown(p(200, 200, 900));
    expect(d.pointerUp(p(200, 200, 950))).toBe('tap');
  });
});

describe('pinch math', () => {
  it('computes distance, center and scale', () => {
    const s = pinchState({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(s.distance).toBe(50);
    expect(s.center).toEqual({ x: 15, y: 20 });
    expect(pinchScale(50, 100)).toBe(2);
    expect(pinchScale(50, 25)).toBe(0.5);
    expect(pinchScale(2, 100)).toBe(1); // degenerate start
    expect(pinchScale(10, 10000)).toBe(8); // clamped
  });

  it('finds the nearest point within a radius', () => {
    const pts = [{ x: 0, y: 0 }, null, { x: 10, y: 0 }, { x: 100, y: 100 }];
    expect(nearestWithin(pts, { x: 8, y: 1 }, 20)).toBe(2);
    expect(nearestWithin(pts, { x: 60, y: 60 }, 20)).toBe(-1);
  });
});
