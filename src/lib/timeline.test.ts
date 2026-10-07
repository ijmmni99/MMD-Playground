import { describe, expect, it } from 'vitest';
import { clampFrame, formatTimecode, frameToSeconds, frameToX, keyframeColumns, rulerStep, secondsToFrame, snapFrame, stepFrame, xToFrame, zoomAt } from './timeline';

describe('timeline math', () => {
  it('converts between frames and seconds at 30fps', () => {
    expect(frameToSeconds(90)).toBe(3);
    expect(secondsToFrame(1.5)).toBe(45);
  });
  it('snaps and clamps frames', () => {
    expect(snapFrame(10.4, 100)).toBe(10);
    expect(snapFrame(10.6, 100)).toBe(11);
    expect(snapFrame(-3, 100)).toBe(0);
    expect(snapFrame(150, 100)).toBe(100);
    expect(snapFrame(Number.NaN, 100)).toBe(0);
    expect(clampFrame(120.5, 100)).toBe(100);
  });
  it('formats timecodes as mm:ss.ff', () => {
    expect(formatTimecode(0)).toBe('00:00.00');
    expect(formatTimecode(31)).toBe('00:01.01');
    expect(formatTimecode(30 * 75 + 29)).toBe('01:15.29');
  });
  it('maps frames to pixels and back', () => {
    const view = { start: 100, zoom: 4 };
    expect(frameToX(110, view)).toBe(40);
    expect(xToFrame(40, view)).toBe(110);
  });
  it('picks readable ruler steps', () => {
    expect(rulerStep(10)).toBe(10);
    expect(rulerStep(2)).toBe(30);
    expect(rulerStep(0.1)).toBe(600);
  });
  it('zooms around an anchor', () => {
    const v = zoomAt({ start: 0, zoom: 2 }, 100, 2);
    expect(v.zoom).toBe(4);
    expect(frameToX(100, v)).toBeCloseTo(frameToX(100, { start: 0, zoom: 2 }));
    expect(zoomAt({ start: 0, zoom: 39 }, 0, 10).zoom).toBe(40);
  });
  it('dedupes keyframe columns', () => {
    expect(keyframeColumns([0, 0.1, 1, 2, 50], { start: 0, zoom: 1 }, 10)).toEqual([0, 1, 2]);
  });
  it('steps with loop semantics', () => {
    expect(stepFrame(95, 10, 100, false)).toBe(100);
    expect(stepFrame(95, 10, 100, true)).toBe(5);
    expect(stepFrame(5, -10, 100, true)).toBe(95);
    expect(stepFrame(5, -10, 100, false)).toBe(0);
  });
});
