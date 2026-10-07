import { describe, expect, it } from 'vitest';
import { axisAngle, qdot } from '@/lib/math3d';
import { sampleBone, sampleCamera, sampleMorph } from './evaluate';
import { makeClip, rng } from './fixtures';
import {
  additive,
  autoBlink,
  bake,
  BLINK_MORPH,
  crossfade,
  deleteTime,
  insertTime,
  loop,
  mirror,
  mirrorName,
  offsetScale,
  reduce,
  retargetScale,
  retime,
  smooth,
  trim,
  vowel,
} from './tools';
import { emptyClip, linearCurves, type BoneKey, type MotionClip, type Quat } from './types';

const track = (c: MotionClip, n: string) => c.bones.find((t) => t.name === n)!;
const same = (a: Quat, b: Quat, eps = 1e-4): boolean => Math.abs(Math.abs(qdot(a, b)) - 1) < eps;
const close3 = (a: number[], b: number[], eps = 1e-4) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('time tools', () => {
  const clip = makeClip(2, { frames: 120, step: 10 });

  it('trim keeps the motion of the range, starting at 0', () => {
    const t = trim(clip, 25, 75);
    for (const f of [0, 7, 30, 50]) {
      const a = sampleBone(track(clip, 'センター').keys, f + 25);
      const b = sampleBone(track(t, 'センター').keys, f);
      expect(close3(a.p, b.p, 1e-3)).toBe(true);
    }
    expect(Math.max(...track(t, 'センター').keys.map((k) => k.f))).toBe(50);
    expect(t.camera[0].f).toBe(0);
  });

  it('insert / delete time are inverse', () => {
    const ins = insertTime(clip, 40, 15);
    expect(track(ins, '上半身').keys.map((k) => k.f)).toContain(55);
    const back = deleteTime(ins, 40, 55);
    expect(track(back, '上半身').keys.map((k) => k.f)).toEqual(track(clip, '上半身').keys.map((k) => k.f));
    for (const f of [0, 33, 61, 100]) {
      expect(
        same(sampleBone(track(back, '上半身').keys, f).r, sampleBone(track(clip, '上半身').keys, f).r),
      ).toBe(true);
    }
  });

  it('retime scales a range and shifts the rest; camera cuts stay cuts', () => {
    const c = { ...clip, camera: [...clip.camera] };
    c.camera = [
      { ...clip.camera[0], f: 0 },
      { ...clip.camera[0], f: 20, t: [1, 2, 3] },
      { ...clip.camera[0], f: 21, t: [5, 5, 5] },
      { ...clip.camera[0], f: 60 },
    ];
    const r = retime(c, 0, 60, 2);
    expect(r.camera.map((k) => k.f)).toEqual([0, 40, 41, 120]);
    expect(track(r, 'センター').keys.map((k) => k.f)).toContain(120);
    expect(track(r, 'センター').keys.map((k) => k.f)).toContain(130); // 70 → shifted by 60
    // Cut: frame 40 holds the first key.
    expect(sampleCamera(r.camera, 40.5).t).toEqual([1, 2, 3]);
  });

  it('loop repeats a range with a seamless (blended) seam', () => {
    const l = loop(clip, 0, 40, 3, 6);
    const keys = track(l, '上半身').keys;
    expect(Math.max(...keys.map((k) => k.f))).toBe(120 + 80);
    // Second repetition equals the first.
    for (const f of [5, 15, 25]) expect(same(sampleBone(keys, f).r, sampleBone(keys, f + 40).r)).toBe(true);
    // Seam: frame 40 value equals frame 0 value (blended), no jump between 39 and 40.
    expect(same(sampleBone(keys, 40).r, sampleBone(keys, 0).r)).toBe(true);
    const d = Math.acos(Math.min(1, Math.abs(qdot(sampleBone(keys, 39).r, sampleBone(keys, 40).r)))) * 2;
    expect(d).toBeLessThan(0.1);
  });
});

describe('mirror', () => {
  it('swaps sides and flips X (IK included); twice is identity', () => {
    expect(mirrorName('左足ＩＫ')).toBe('右足ＩＫ');
    expect(mirrorName('右腕')).toBe('左腕');
    expect(mirrorName('上半身')).toBe('上半身');
    const clip = makeClip(4);
    const m = mirror(clip);
    const ik = track(clip, '左足ＩＫ').keys[3];
    const mk = track(m, '右足ＩＫ').keys[3];
    expect(mk.p).toEqual([-ik.p[0], ik.p[1], ik.p[2]]);
    expect(mk.r).toEqual([ik.r[0], -ik.r[1], -ik.r[2], ik.r[3]]);
    expect(m.bones.some((t) => t.name === '左足ＩＫ')).toBe(false);
    const mm = mirror(m);
    expect(track(mm, '左腕').keys).toEqual(track(clip, '左腕').keys);
    expect(track(mm, '左足ＩＫ').keys).toEqual(track(clip, '左足ＩＫ').keys);
  });

  it('mirrors only a range', () => {
    const clip = makeClip(4);
    const m = mirror(clip, {}, 0, 30);
    expect(track(m, '右腕').keys.filter((k) => k.f > 30)).toEqual(
      track(clip, '右腕').keys.filter((k) => k.f > 30),
    );
    expect(track(m, '右腕').keys.find((k) => k.f === 10)!.r[1]).toBeCloseTo(
      -track(clip, '左腕').keys.find((k) => k.f === 10)!.r[1],
    );
  });
});

describe('smooth / bake / reduce', () => {
  const noisy = (): MotionClip => {
    const r = rng(9);
    const keys: BoneKey[] = [];
    for (let f = 0; f <= 90; f++) {
      const a = Math.sin(f / 10) * 0.8 + (r() - 0.5) * 0.15;
      // Alternate hemispheres to prove quaternion-safety.
      const q = axisAngle([0, 1, 0], a);
      keys.push({
        f,
        p: [Math.sin(f / 10) + (r() - 0.5) * 0.2, 0, 0],
        r: f % 2 ? (q.map((v) => -v) as Quat) : q,
        ip: linearCurves(4),
      });
    }
    return { ...emptyClip(), bones: [{ name: 'センター', keys }] };
  };
  const jitter = (c: MotionClip): number => {
    const k = track(c, 'センター').keys;
    let s = 0;
    for (let i = 2; i < k.length; i++) s += Math.abs(k[i].p[0] - 2 * k[i - 1].p[0] + k[i - 2].p[0]);
    return s;
  };

  for (const method of ['gaussian', 'one-euro'] as const) {
    it(`${method} reduces jitter, quaternion-safe`, () => {
      const c = noisy();
      const s = smooth(c, 0, 90, { method, strength: method === 'gaussian' ? 2 : 1 });
      expect(jitter(s)).toBeLessThan(jitter(c) * 0.5);
      const ks = track(s, 'センター').keys;
      for (const k of ks) expect(Math.hypot(...k.r)).toBeCloseTo(1, 6);
      // Smoothed rotation stays close to the underlying signal (no flips through the hemisphere change).
      for (const f of [20, 45, 70]) {
        const ang =
          2 * Math.acos(Math.min(1, Math.abs(qdot(ks[f].r, axisAngle([0, 1, 0], Math.sin(f / 10) * 0.8)))));
        expect(ang).toBeLessThan(0.15);
      }
    });
  }

  it('bake then reduce reproduces the motion within tolerance', () => {
    const clip = makeClip(6, { frames: 120, step: 10, randomCurves: true });
    const b = bake(clip, 0, 120);
    expect(track(b, '左腕').keys.length).toBe(121);
    const r = reduce(b, 0, 120, { pos: 0.01, rot: 0.5 });
    const n = track(r, '左腕').keys.length;
    expect(n).toBeLessThan(121);
    for (let f = 0; f <= 120; f += 1) {
      const a = sampleBone(track(clip, '左腕').keys, f).r;
      const c = sampleBone(track(r, '左腕').keys, f).r;
      expect((2 * Math.acos(Math.min(1, Math.abs(qdot(a, c)))) * 180) / Math.PI).toBeLessThan(0.6);
    }
  });
});

describe('offset / scale / blend / face', () => {
  it('offset with falloff fades out', () => {
    const clip = makeClip(1, { frames: 100, step: 5 });
    const o = offsetScale(clip, 40, 60, { pos: [0, 1, 0], falloff: 10 }, { bones: ['センター'] });
    const y = (f: number) =>
      track(o, 'センター').keys.find((k) => k.f === f)!.p[1] -
      track(clip, 'センター').keys.find((k) => k.f === f)!.p[1];
    expect(y(50)).toBeCloseTo(1);
    expect(y(35)).toBeGreaterThan(0);
    expect(y(35)).toBeLessThan(1);
    expect(y(25)).toBeCloseTo(0);
    expect(track(o, '上半身')).toBe(track(clip, '上半身'));
  });

  it('retarget scale scales translations only', () => {
    const clip = makeClip(1);
    const s = retargetScale(clip, 2);
    expect(track(s, 'センター').keys[3].p[0]).toBeCloseTo(track(clip, 'センター').keys[3].p[0] * 2);
    expect(track(s, '上半身')).toBe(track(clip, '上半身'));
  });

  it('crossfade goes from A to B smoothly', () => {
    const a = makeClip(1, { frames: 120 });
    const b = makeClip(2, { frames: 120 });
    const c = crossfade(a, b, 50, 20);
    const k = track(c, '上半身').keys;
    expect(same(sampleBone(k, 30).r, sampleBone(track(a, '上半身').keys, 30).r)).toBe(true);
    expect(same(sampleBone(k, 100).r, sampleBone(track(b, '上半身').keys, 50).r)).toBe(true);
  });

  it('additive layer adds rotation on top of the base', () => {
    const base = makeClip(1, { frames: 60 });
    const layer: MotionClip = {
      ...emptyClip(),
      bones: [
        {
          name: '上半身',
          keys: [0, 60].map((f) => ({ f, p: [0, 0, 0], r: axisAngle([1, 0, 0], 0.3), ip: linearCurves(4) })),
        },
      ],
    };
    const out = additive(base, layer, 1);
    const f = 25;
    const got = sampleBone(track(out, '上半身').keys, f).r;
    const b = sampleBone(track(base, '上半身').keys, f).r;
    // Removing the layer rotation gives the base back.
    const angle = 2 * Math.acos(Math.min(1, Math.abs(qdot(got, b))));
    expect(angle).toBeCloseTo(0.3, 3);
  });

  it('auto-blink is seeded, in range and returns to open', () => {
    const c = autoBlink(emptyClip(), 0, 600, { seed: 1 });
    const t = c.morphs.find((m) => m.name === BLINK_MORPH)!;
    expect(t.keys.length).toBeGreaterThan(12);
    expect(t.keys.every((k) => k.f >= 0 && k.f <= 600)).toBe(true);
    expect(t.keys[t.keys.length - 1].w).toBe(0);
    expect(autoBlink(emptyClip(), 0, 600, { seed: 1 })).toEqual(c);
    const v = vowel(emptyClip(), 10, 'あ', 8);
    expect(sampleMorph(v.morphs[0], 14)).toBe(1);
    expect(sampleMorph(v.morphs[0], 18)).toBe(0);
  });
});
