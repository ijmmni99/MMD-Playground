import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { describe, expect, it } from 'vitest';
import { qdot } from '@/lib/math3d';
import {
  eulerToQuat,
  keyCurve,
  quatContinuity,
  quatToEuler,
  sampleChannels,
  setChannelValue,
  setCurves,
  unwrapNear,
} from './curves';
import { sampleBone } from './evaluate';
import { makeClip } from './fixtures';
import type { Quat } from './types';

describe('Euler conversion', () => {
  it('matches babylon toEulerAngles / RotationYawPitchRoll', () => {
    for (const [x, y, z] of [
      [0.3, -1.2, 0.7],
      [-1.1, 2.9, -0.2],
      [1.5, 0.1, 3.0],
    ]) {
      const bq = Quaternion.RotationYawPitchRoll(y, x, z);
      const q = eulerToQuat([x, y, z]);
      expect(q[0]).toBeCloseTo(bq.x, 9);
      expect(q[1]).toBeCloseTo(bq.y, 9);
      expect(q[2]).toBeCloseTo(bq.z, 9);
      expect(q[3]).toBeCloseTo(bq.w, 9);
      const be = bq.toEulerAngles();
      const e = quatToEuler(q);
      expect(e[0]).toBeCloseTo(be.x, 9);
      expect(e[1]).toBeCloseTo(be.y, 9);
      expect(e[2]).toBeCloseTo(be.z, 9);
      // Round trip back to the same rotation.
      expect(Math.abs(qdot(eulerToQuat(e), q))).toBeCloseTo(1, 9);
    }
  });

  it('unwraps angles and keeps quaternions in one hemisphere', () => {
    expect(unwrapNear(-3.1, 3.1)).toBeCloseTo(-3.1 + 2 * Math.PI);
    const qs: Quat[] = [
      [0, 0, 0, 1],
      [0, 0, 0.1, -0.995],
      [0, 0, -0.2, 0.98],
    ];
    const c = quatContinuity(qs);
    for (let i = 1; i < c.length; i++) expect(qdot(c[i - 1], c[i])).toBeGreaterThan(0);
  });

  it('samples rotation channels continuously across ±180°', () => {
    const clip = makeClip(1, { frames: 0 });
    const turn = (a: number): Quat => eulerToQuat([0, a, 0]);
    clip.bones = [
      {
        name: 'センター',
        keys: [
          {
            f: 0,
            p: [0, 0, 0],
            r: turn(3.0),
            ip: Array.from({ length: 16 }, (_, i) => (i % 4 < 2 ? 20 : 107)),
          },
          {
            f: 10,
            p: [0, 0, 0],
            r: turn(-3.0),
            ip: Array.from({ length: 16 }, (_, i) => (i % 4 < 2 ? 20 : 107)),
          },
        ],
      },
    ];
    const frames = Array.from({ length: 11 }, (_, i) => i);
    const s = sampleChannels(clip, 'bone', 'センター', frames);
    const ry = s.values[4];
    for (let i = 1; i < ry.length; i++) expect(Math.abs(ry[i] - ry[i - 1])).toBeLessThan(10);
    expect(Math.abs(ry[10] - ry[0])).toBeCloseTo((2 * Math.PI - 6) * (180 / Math.PI), 3);
  });
});

describe('graph edits', () => {
  it('sets a position, rotation and camera value on a key', () => {
    const clip = makeClip(3, { frames: 60, step: 10 });
    const bone = clip.bones[0];
    const f = bone.keys[1].f;
    const a = setChannelValue(clip, 'bone', bone.name, f, 1, 4.5);
    expect(a.bones[0].keys[1].p[1]).toBe(4.5);
    expect(a.bones[1]).toBe(clip.bones[1]);
    const b = setChannelValue(clip, 'bone', bone.name, f, 3, 30);
    const e = quatToEuler(b.bones[0].keys[1].r);
    expect(e[0] * (180 / Math.PI)).toBeCloseTo(30, 6);
    expect(qdot(b.bones[0].keys[1].r, bone.keys[1].r)).toBeGreaterThanOrEqual(0);
    expect(sampleBone(b.bones[0].keys, f).r).toEqual(b.bones[0].keys[1].r.map((v) => expect.closeTo(v, 3)));
    const cf = clip.camera[0].f;
    const c = setChannelValue(clip, 'camera', '__camera__', cf, 7, 300);
    expect(c.camera[0].fov).toBe(179);
  });

  it('writes bezier handles to one channel or all, clamped to bytes', () => {
    const clip = makeClip(5, { frames: 60, step: 10 });
    const t = clip.bones[0];
    const ref = { kind: 'bone' as const, track: t.name, f: t.keys[2].f };
    const one = setCurves(clip, [ref], 3, [64, -5, 200, 127]);
    expect(keyCurve(one, 'bone', t.name, ref.f, 3)).toEqual([64, 0, 127, 127]);
    expect(keyCurve(one, 'bone', t.name, ref.f, 0)).toEqual(keyCurve(clip, 'bone', t.name, ref.f, 0));
    const all = setCurves(clip, [ref], null, [127, 0, 127, 0]);
    for (let ch = 0; ch < 4; ch++) expect(keyCurve(all, 'bone', t.name, ref.f, ch)).toEqual([127, 0, 127, 0]);
    expect(all.bones[0].keys[1]).toBe(clip.bones[0].keys[1]);
  });
});
