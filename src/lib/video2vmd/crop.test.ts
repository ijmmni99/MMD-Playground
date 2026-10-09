import { describe, expect, it } from 'vitest';
import {
  CropTracker,
  areaToCrop,
  cropToArea,
  headWindow,
  mapPointsToArea,
  sourceRect,
  toNormalized,
  wristWindow,
} from './crop';
import { fixtureCameras, syntheticScene, viewFrame } from './synthetic';

const SIZE: [number, number] = [640, 360];

describe('crop windows', () => {
  it('head and wrist windows contain the face and hand landmarks', () => {
    const [front] = fixtureCameras(90, SIZE);
    for (const t of [0.2, 1.1, 2.7]) {
      const v = viewFrame(syntheticScene(t), { camera: front });
      const head = toNormalized(headWindow(v.image, SIZE)!, SIZE);
      for (let i = 0; i < v.face!.points.length; i += 2) {
        const [u, w] = areaToCrop(head, v.face!.points[i], v.face!.points[i + 1]);
        expect(u).toBeGreaterThan(0);
        expect(u).toBeLessThan(1);
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThan(1);
      }
      for (const side of [0, 1] as const) {
        const win = toNormalized(wristWindow(v.image, side, SIZE)!, SIZE);
        const hand = v.hands[side]!;
        for (let i = 0; i < 21; i++) {
          const [u, w] = areaToCrop(win, hand.image[i * 3], hand.image[i * 3 + 1]);
          expect(u).toBeGreaterThan(-0.05);
          expect(u).toBeLessThan(1.05);
          expect(w).toBeGreaterThan(-0.05);
          expect(w).toBeLessThan(1.05);
        }
      }
    }
  });

  it('returns null when the anchors are not visible', () => {
    const lm = new Float32Array(33 * 4);
    expect(headWindow(lm, SIZE)).toBeNull();
    expect(wristWindow(lm, 0, SIZE)).toBeNull();
  });

  it('tracker smooths jitter, limits size changes and holds briefly on dropout', () => {
    const tr = new CropTracker(3);
    const dt = 1 / 30;
    let prev = tr.update({ cx: 100, cy: 100, size: 80 }, dt)!;
    let jitterIn = 0;
    let jitterOut = 0;
    for (let i = 1; i < 60; i++) {
      const target = { cx: 100 + (i % 2 ? 6 : -6), cy: 100, size: 80 };
      const w = tr.update(target, dt)!;
      jitterIn += 12;
      jitterOut += Math.abs(w.cx - prev.cx);
      prev = w;
    }
    expect(jitterOut).toBeLessThan(jitterIn * 0.5);
    const grown = tr.update({ cx: 100, cy: 100, size: 400 }, dt)!;
    expect(grown.size).toBeLessThanOrEqual(prev.size * 1.15 + 1e-6);
    expect(tr.update(null, dt)).not.toBeNull();
    tr.update(null, dt);
    tr.update(null, dt);
    expect(tr.update(null, dt)).toBeNull();
  });

  it('maps crop coordinates back to the analysed area and to source pixels', () => {
    const c = { x: 0.2, y: 0.1, w: 0.25, h: 0.4 };
    const [x, y] = cropToArea(c, 0.5, 0.5);
    expect(x).toBeCloseTo(0.325);
    expect(y).toBeCloseTo(0.3);
    areaToCrop(c, x, y).forEach((v) => expect(v).toBeCloseTo(0.5));
    mapPointsToArea(c, [0, 0, 7, 1, 1, 9], 3).forEach((v, i) =>
      expect(v).toBeCloseTo([0.2, 0.1, 7, 0.45, 0.5, 9][i]),
    );
    // Analysed area = right half of a 1920×1080 source.
    const r = sourceRect(c, { x: 0.5, y: 0, w: 0.5, h: 1 }, [1920, 1080]);
    expect(r.sx).toBeCloseTo((0.5 + 0.2 * 0.5) * 1920);
    expect(r.sw).toBeCloseTo(0.25 * 0.5 * 1920);
    expect(r.sh).toBeCloseTo(0.4 * 1080);
  });
});
