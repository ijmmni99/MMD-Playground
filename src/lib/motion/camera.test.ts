import { describe, expect, it } from 'vitest';
import {
  addShake,
  bakeLookAt,
  cameraEye,
  cameraForward,
  cameraFromEyeTarget,
  clampCamera,
  cutFrames,
  deleteShot,
  generatePreset,
  makeCameraKey,
  mergeShots,
  reorderShot,
  splitShot,
  validateCamera,
  writeShotBoundaries,
} from './camera';
import { sampleCamera } from './evaluate';
import type { CameraKey, Shot, Vec3 } from './types';

const near = (a: number[], b: number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('camera geometry', () => {
  it('default MMD camera sits at -Z looking +Z', () => {
    const c = { t: [0, 10, 0] as Vec3, r: [0, 0, 0] as Vec3, d: -45 };
    expect(near(cameraEye(c), [0, 10, -45])).toBe(true);
    expect(near(cameraForward(c.r), [0, 0, 1])).toBe(true);
  });

  it('matches babylon-mmd MmdCamera eye placement', async () => {
    const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine');
    const { Scene } = await import('@babylonjs/core/scene');
    const { Vector3 } = await import('@babylonjs/core/Maths/math.vector');
    const { MmdCamera } = await import('babylon-mmd/esm/Runtime/mmdCamera');
    const scene = new Scene(new NullEngine());
    const cam = new MmdCamera('c', new Vector3(1, 2, 3), scene);
    cam.rotation.set(0.3, -1.1, 0.2);
    cam.distance = -30;
    const view = cam.getViewMatrix(true);
    const eye = view.clone().invert().getTranslation();
    const ours = cameraEye({ t: [1, 2, 3], r: [0.3, -1.1, 0.2], d: -30 });
    expect(near([eye.x, eye.y, eye.z], ours, 1e-4)).toBe(true);
  });

  it('eye/target round trip', () => {
    const eye: Vec3 = [12, 18, -30];
    const target: Vec3 = [0, 11, 2];
    const v = cameraFromEyeTarget(eye, target);
    expect(near(cameraEye(v), eye, 1e-6)).toBe(true);
    const f = cameraForward(v.r);
    const d = Math.hypot(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
    expect(
      near(f, [(target[0] - eye[0]) / d, (target[1] - eye[1]) / d, (target[2] - eye[2]) / d], 1e-6),
    ).toBe(true);
  });
});

const base = (): CameraKey[] => [
  makeCameraKey(0, { t: [0, 10, 0], r: [0, 0, 0], d: -40, fov: 30 }),
  makeCameraKey(60, { t: [0, 10, 0], r: [0, 1, 0], d: -30, fov: 30 }),
  makeCameraKey(120, { t: [0, 12, 0], r: [0.2, 2, 0], d: -30, fov: 40 }),
];

describe('look-at, shake, validation', () => {
  it('look-at keeps the eye path and centres the point', () => {
    const point = (f: number): Vec3 => [Math.sin(f / 20) * 5, 12, f / 10];
    const keys = bakeLookAt(base(), 0, 120, point, 2);
    expect(cutFrames(keys)).toEqual([]);
    for (const f of [10, 40, 90]) {
      const s = sampleCamera(keys, f);
      const eye = cameraEye(s);
      const p = point(f);
      const want = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
      const n = Math.hypot(...want);
      expect(
        near(
          cameraForward(s.r),
          want.map((v) => v / n),
          0.03,
        ),
      ).toBe(true);
      expect(near(eye, cameraEye(sampleCamera(base(), f)), 0.5)).toBe(true);
    }
  });

  it('shake is seeded, bounded and fades at the edges', () => {
    const a = addShake(base(), 0, 120, { seed: 3, amplitude: 1 });
    expect(addShake(base(), 0, 120, { seed: 3, amplitude: 1 })).toEqual(a);
    expect(addShake(base(), 0, 120, { seed: 4, amplitude: 1 })).not.toEqual(a);
    expect(cutFrames(a)).toEqual([]);
    for (const k of a) {
      const s = sampleCamera(base(), k.f);
      expect(Math.abs(k.r[0] - s.r[0])).toBeLessThan((1.01 * Math.PI) / 180);
    }
    expect(near(a[0].r, base()[0].r, 1e-9)).toBe(true);
  });

  it('flags and clamps invalid FOV / distance', () => {
    const bad = [
      makeCameraKey(0, { t: [0, 0, 0], r: [0, 0, 0], d: 0, fov: 30 }),
      { ...makeCameraKey(5, { t: [0, 0, 0], r: [0, 0, 0], d: -20, fov: 30 }), fov: 170 },
    ];
    expect(validateCamera(bad).length).toBe(2);
    expect(validateCamera(clampCamera(bad))).toEqual([]);
  });
});

describe('shots', () => {
  const shots = (): Shot[] => [
    { id: 'a', name: 'A', start: 0, end: 59, color: '#f00', transition: 'cut' },
    { id: 'b', name: 'B', start: 60, end: 120, color: '#0f0', transition: 'cut' },
  ];

  it('writes cuts as consecutive-frame keys (step at the boundary)', () => {
    const keys = writeShotBoundaries(base(), shots());
    expect(cutFrames(keys)).toEqual([60]);
    const before = sampleCamera(keys, 59.5);
    const at = sampleCamera(keys, 60);
    // Holds shot A's value right up to the cut, then jumps.
    expect(near(before.r, sampleCamera(keys, 59).r, 1e-3)).toBe(true);
    expect(near(at.r, [0, 1, 0], 1e-3)).toBe(true);
    // Blend: no cut pair.
    const blended = writeShotBoundaries(
      keys,
      shots().map((s) => ({ ...s, transition: 'blend' as const })),
    );
    expect(cutFrames(blended)).toEqual([]);
  });

  it('split / merge / reorder / delete', () => {
    const s2 = splitShot(shots(), 30, 'c');
    expect(s2.map((s) => [s.start, s.end])).toEqual([
      [0, 29],
      [30, 59],
      [60, 120],
    ]);
    expect(mergeShots(s2, 'a').map((s) => [s.start, s.end])).toEqual([
      [0, 59],
      [60, 120],
    ]);
    const r = reorderShot(base(), shots(), 'b', 0);
    expect(r.shots.map((s) => s.id)).toEqual(['b', 'a']);
    expect(r.shots.map((s) => [s.start, s.end])).toEqual([
      [0, 60],
      [61, 120],
    ]);
    // Shot B's opening view now starts at 0, and A's opening view at its new start.
    expect(near(sampleCamera(r.keys, 0).r, [0, 1, 0], 1e-3)).toBe(true);
    expect(near(sampleCamera(r.keys, 61).r, [0, 0, 0], 1e-3)).toBe(true);
    expect(cutFrames(r.keys)).toContain(61);
    const d = deleteShot(base(), shots(), 'a');
    expect(d.shots).toEqual([{ ...shots()[1], start: 0, end: 60 }]);
    expect(near(sampleCamera(d.keys, 0).r, [0, 1, 0], 1e-3)).toBe(true);
  });
});

describe('presets', () => {
  const grid = { bpm: 120, offset: 0, beatsPerBar: 4 };
  it('orbit keys land on beats and go round once', () => {
    const k = generatePreset([], 'orbit', { from: 1, to: 121, subject: [0, 10, 0], grid });
    for (const key of k) expect(key.f % 15).toBe(0);
    expect(k[0].f).toBe(0);
    expect(k[k.length - 1].f).toBe(120);
    expect(k[k.length - 1].r[1] - k[0].r[1]).toBeCloseTo(2 * Math.PI);
  });

  it('front-to-side cut is a real cut on a bar line', () => {
    const k = generatePreset(base(), 'front-side-cut', { from: 0, to: 120, subject: [0, 10, 0], grid });
    const cuts = cutFrames(k);
    expect(cuts.length).toBe(1);
    expect(cuts[0] % 60).toBe(0);
  });

  it('presets keep keys outside the range and cut in cleanly', () => {
    const k = generatePreset(base(), 'dolly-in', { from: 90, to: 150, subject: [0, 10, 0], grid });
    expect(k.find((x) => x.f === 0)).toBeDefined();
    expect(cutFrames(k)).toContain(90);
  });
});

describe('baking keeps cuts', () => {
  it('look-at over a cut keeps exactly that cut', () => {
    const keys = writeShotBoundaries(base(), [
      { id: 'a', name: 'A', start: 0, end: 59, color: '#f00', transition: 'cut' },
      { id: 'b', name: 'B', start: 60, end: 120, color: '#0f0', transition: 'cut' },
    ]);
    const baked = bakeLookAt(keys, 0, 119, () => [0, 12, 0], 2);
    expect(cutFrames(baked)).toEqual([60]);
    const shaken = addShake(keys, 0, 119, { seed: 2 });
    expect(cutFrames(shaken)).toEqual([60]);
  });
});
