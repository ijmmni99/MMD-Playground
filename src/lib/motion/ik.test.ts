import { describe, expect, it } from 'vitest';
import { dist, type Vec3 } from '@/lib/math3d';
import { sampleBone } from './evaluate';
import {
  applyPins,
  chainPositions,
  hingeAngle,
  ikStateAt,
  pinWeight,
  setIkRange,
  solveIk,
  syntheticLeg,
  writeDenseKeys,
} from './ik';
import { BONE_CHANNELS, linearCurves, type MotionClip } from './types';
import { emptyClip } from './types';

const ikClip = (): MotionClip => ({
  ...emptyClip('m'),
  bones: [
    {
      name: '左足ＩＫ',
      keys: [0, 10, 20, 30, 40, 50, 60].map((f) => ({
        f,
        p: [Math.sin(f / 10) * 2, Math.max(-0.5, Math.cos(f / 7)), f / 20] as Vec3,
        r: [0, 0, 0, 1] as [number, number, number, number],
        ip: linearCurves(BONE_CHANNELS),
      })),
    },
  ],
});

describe('pins', () => {
  it('weights ease in and out around the range', () => {
    const pin = { id: 'p', bone: 'x', start: 10, end: 20, blendIn: 4, blendOut: 4 };
    expect(pinWeight(pin, 15)).toBe(1);
    expect(pinWeight(pin, 5)).toBe(0);
    expect(pinWeight(pin, 8)).toBeGreaterThan(0);
    expect(pinWeight(pin, 8)).toBeLessThan(1);
    expect(pinWeight(pin, 25)).toBe(0);
  });

  it('holds the foot position within epsilon inside the range and never sinks', () => {
    const clip = ikClip();
    const pin = { id: 'p', bone: '左足ＩＫ', start: 12, end: 28, blendIn: 3, blendOut: 3 };
    const out = applyPins(clip, [pin]);
    const keys = out.bones[0].keys;
    const anchor = sampleBone(keys, 12).p;
    for (let f = 12; f <= 28; f += 0.5) {
      const p = sampleBone(keys, f).p;
      expect(dist(p, anchor)).toBeLessThan(1e-4); // MMD bezier at x = 0 is ~1e-5, not exactly 0
    }
    for (let f = 0; f <= 60; f++) expect(sampleBone(keys, f).p[1]).toBeGreaterThanOrEqual(0);
    // Outside the blend window the original motion is unchanged.
    for (const f of [0, 5, 40, 50, 60]) {
      const a = sampleBone(clip.bones[0].keys, f).p;
      const b = sampleBone(keys, f).p;
      // (the ground clamp still lifts below-floor values)
      expect(dist([a[0], Math.max(0, a[1]), a[2]], b)).toBeLessThan(1e-4);
    }
  });

  it('editing a key under a pin keeps the planted foot fixed', () => {
    const clip = ikClip();
    const pin = {
      id: 'p',
      bone: '左足ＩＫ',
      start: 12,
      end: 28,
      blendIn: 2,
      blendOut: 2,
      anchor: sampleBone(clip.bones[0].keys, 12),
    };
    const edited = {
      ...clip,
      bones: [
        {
          ...clip.bones[0],
          keys: clip.bones[0].keys.map((k) => (k.f === 20 ? { ...k, p: [9, 9, 9] as Vec3 } : k)),
        },
      ],
    };
    const a = applyPins(clip, [pin]).bones[0].keys;
    const b = applyPins(edited, [pin]).bones[0].keys;
    for (let f = 12; f <= 18; f++) expect(dist(sampleBone(a, f).p, sampleBone(b, f).p)).toBeLessThan(1e-6);
  });
});

describe('CCD IK (MMD semantics)', () => {
  it('reaches reachable targets and never flips the knee forward', () => {
    const leg = syntheticLeg();
    let prev = undefined as ReturnType<typeof solveIk> | undefined;
    let worst = 0;
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      // Ankle target sweeping forward/back and up/down within reach.
      const target: Vec3 = [1, 2.5 + Math.sin(t * Math.PI) * 3, 0.6 + Math.sin(t * Math.PI * 2) * 2];
      const rot = solveIk(leg, target, prev);
      prev = rot;
      const { effector } = chainPositions(leg, rot);
      worst = Math.max(worst, dist(effector, target));
      expect(hingeAngle(rot[0])).toBeLessThanOrEqual(1e-6); // knee bends backward only
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('bakes IK to FK with small round-trip error', () => {
    const leg = syntheticLeg();
    const targets: Vec3[] = Array.from({ length: 30 }, (_, f) => [
      1 + Math.sin(f / 5) * 0.5,
      2 + Math.abs(Math.sin(f / 4)) * 2,
      0.6 + Math.cos(f / 6),
    ]);
    let prev = undefined as ReturnType<typeof solveIk> | undefined;
    const baked = targets.map((t) => (prev = solveIk(leg, t, prev)));
    // Replay FK only: effector must land on the original IK targets.
    const err = baked.map((rot, i) => dist(chainPositions(leg, rot).effector, targets[i]));
    expect(Math.max(...err)).toBeLessThan(0.05);
  });
});

describe('IK ↔ FK writes', () => {
  it('turns IK off over a range and restores it after', () => {
    const clip: MotionClip = {
      ...emptyClip(),
      props: [
        { f: 0, visible: true, ik: { 左足ＩＫ: true, 右足ＩＫ: true } },
        { f: 50, visible: false, ik: { 左足ＩＫ: true, 右足ＩＫ: false } },
      ],
    };
    const out = setIkRange(clip, ['左足ＩＫ'], 20, 60, false);
    expect(ikStateAt(out, '左足ＩＫ', 19)).toBe(true);
    for (const f of [20, 40, 50, 60]) expect(ikStateAt(out, '左足ＩＫ', f)).toBe(false);
    expect(ikStateAt(out, '左足ＩＫ', 61)).toBe(true);
    // Other bones and visibility untouched.
    expect(ikStateAt(out, '右足ＩＫ', 55)).toBe(false);
    expect(ikStateAt(out, '右足ＩＫ', 30)).toBe(true);
    expect(out.props.find((k) => k.f === 50)!.visible).toBe(false);
    // Default (no property track) → on outside the range.
    const bare = setIkRange(emptyClip(), ['左足ＩＫ'], 5, 10, false);
    expect(ikStateAt(bare, '左足ＩＫ', 4)).toBe(true);
    expect(ikStateAt(bare, '左足ＩＫ', 7)).toBe(false);
    expect(ikStateAt(bare, '左足ＩＫ', 11)).toBe(true);
  });

  it('writes dense keys without changing motion outside the range', () => {
    const keys = [0, 30, 60].map((f) => ({
      f,
      p: [f / 10, 0, 0] as Vec3,
      r: [0, 0, 0, 1] as [number, number, number, number],
      ip: linearCurves(BONE_CHANNELS),
    }));
    const clip: MotionClip = { ...emptyClip(), bones: [{ name: '左ひざ', keys }] };
    const dense = Array.from({ length: 11 }, (_, i) => ({
      f: 20 + i,
      r: [0, 0, 0.1, 0.995] as [number, number, number, number],
    }));
    const out = writeDenseKeys(clip, 20, 30, { 左ひざ: dense });
    const t = out.bones[0].keys;
    expect(t.filter((k) => k.f >= 20 && k.f <= 30).length).toBe(11);
    for (const f of [5, 19, 45, 60]) expect(sampleBone(t, f).p[0]).toBeCloseTo(sampleBone(keys, f).p[0], 3);
    expect(sampleBone(t, 25).p[0]).toBeCloseTo(2.5, 3);
  });
});
