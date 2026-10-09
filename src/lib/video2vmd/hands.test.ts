import { describe, expect, it } from 'vitest';
import { forwardKinematics } from '@/engine/video2vmd/retarget';
import type { Skeleton } from '@/engine/video2vmd/skeleton';
import { axisAngle, dist, dot, normalize, rotate, sub, type Vec3 } from '@/lib/math3d';
import { HAND_PRESETS, lerpHandPose, type HandPose } from './handPose';
import {
  FINGER_BONES,
  classifyHand,
  clampPose,
  computeFingerTracks,
  fingerRig,
  fingerRotations,
  handPointsMmd,
  isImpossible,
  measureHand,
  twistAbout,
} from './hands';
import { handPoints } from './synthetic';
import { FINGERS, type HandObs, type HandSettings } from './types';

const SETTINGS: HandSettings = {
  minCutoff: 2,
  beta: 0.3,
  presetSnap: false,
  wristRefine: true,
  reduceTolerance: 0.5,
  holdSeconds: 0.5,
};

function expectPose(measured: HandPose, truth: HandPose, tol: number): void {
  for (const f of FINGERS) {
    measured[f].flex.forEach((v, i) => expect(Math.abs(v - truth[f].flex[i])).toBeLessThan(tol));
    if (f !== 'thumb') expect(Math.abs(measured[f].spread - truth[f].spread)).toBeLessThan(tol);
  }
}

/** Hand points → MediaPipe hand-world layout (y down), as the estimator reports them. */
const toMp = (pts: Vec3[]): number[] => pts.flatMap((p) => [p[0], -p[1], p[2]]);

describe('finger flexion math', () => {
  it('recovers joint angles of every preset, for both hands, in any orientation', () => {
    const tilt = axisAngle(normalize([0.3, 1, 0.2]), 0.9);
    for (const id of ['open', 'relaxed', 'fist', 'point', 'peace'] as const) {
      for (const side of ['left', 'right'] as const) {
        const h: Vec3 = side === 'left' ? [1, -0.3, 0] : [-1, -0.3, 0];
        const pts = handPoints(
          [0, 1, 0],
          rotate(tilt, normalize(h)),
          rotate(tilt, [0, 0, -1]),
          side,
          HAND_PRESETS[id],
        );
        expectPose(measureHand(pts, side), HAND_PRESETS[id], 3);
        // Through the MediaPipe axis convention and back.
        expectPose(measureHand(handPointsMmd(toMp(pts), false), side), HAND_PRESETS[id], 3);
      }
    }
  });

  it('clamps to anatomical limits and flags impossible poses', () => {
    const p = lerpHandPose(HAND_PRESETS.fist, HAND_PRESETS.fist, 0);
    p.index.flex = [130, -20, 95];
    p.middle.spread = 40;
    const c = clampPose(p);
    expect(c.index.flex).toEqual([95, 0, 90]);
    expect(c.middle.spread).toBe(20);
    expect(isImpossible(p)).toBe(true);
    expect(isImpossible(HAND_PRESETS.fist)).toBe(false);
  });

  it('classifies presets', () => {
    expect(classifyHand(HAND_PRESETS.point).id).toBe('point');
    expect(classifyHand(lerpHandPose(HAND_PRESETS.fist, HAND_PRESETS.open, 0.1)).id).toBe('fist');
    expect(classifyHand(HAND_PRESETS.peace).id).toBe('peace');
  });

  it('isolates the twist of a rotation about an axis', () => {
    const q = axisAngle([1, 0, 0], 0.7);
    const t = twistAbout(q, [1, 0, 0]);
    expect(Math.abs(t[0])).toBeCloseTo(Math.sin(0.35));
    const swingOnly = twistAbout(axisAngle([0, 1, 0], 0.7), [1, 0, 0]);
    expect(swingOnly[3]).toBeCloseTo(1);
  });
});

/** A left / right hand rig in MMD model space (arms along ±X, palms down). */
function handSkeleton(): Skeleton {
  const bones: Skeleton['bones'] = [{ name: '全ての親', parent: -1, position: [0, 0, 0] }];
  for (const [P, sx] of [
    ['左', 1],
    ['右', -1],
  ] as const) {
    const wrist = bones.length;
    bones.push({ name: `${P}手首`, parent: 0, position: [5 * sx, 12, 0] });
    const fingers: [string[], number, number][] = [
      [FINGER_BONES.thumb.map((b) => P + b), 5.2, -0.4],
      [FINGER_BONES.index.map((b) => P + b), 5.8, -0.3],
      [FINGER_BONES.middle.map((b) => P + b), 5.9, 0],
      [FINGER_BONES.ring.map((b) => P + b), 5.8, 0.25],
      [FINGER_BONES.little.map((b) => P + b), 5.7, 0.5],
    ];
    for (const [names, x, z] of fingers) {
      let parent = wrist;
      names.forEach((n, i) => {
        bones.push({
          name: n,
          parent,
          position: [(x + i * 0.35) * sx, 12, z - (n.includes('親指') ? i * 0.2 : 0)],
        });
        parent = bones.length - 1;
      });
    }
  }
  return { name: 'hands', bones };
}

describe('finger retargeting', () => {
  it('curls the model fingers toward the palm (down) for a fist, on both sides', () => {
    const sk = handSkeleton();
    for (const side of ['left', 'right'] as const) {
      const rig = fingerRig(sk.bones, side)!;
      expect(rig.n[1]).toBeLessThan(-0.9);
      const rots = fingerRotations(rig, HAND_PRESETS.fist);
      const P = side === 'left' ? '左' : '右';
      const rest = forwardKinematics(sk, new Map());
      const fist = forwardKinematics(sk, rots);
      const i3 = sk.bones.findIndex((b) => b.name === `${P}人指３`);
      expect(fist.positions[i3][1]).toBeLessThan(rest.positions[i3][1] - 0.3);
      // Bone lengths are untouched.
      const i2 = sk.bones.findIndex((b) => b.name === `${P}人指２`);
      expect(dist(fist.positions[i3], fist.positions[i2])).toBeCloseTo(
        dist(rest.positions[i3], rest.positions[i2]),
        5,
      );
      // Open hand → nearly rest.
      const open = forwardKinematics(sk, fingerRotations(rig, HAND_PRESETS.open));
      expect(dist(open.positions[i3], rest.positions[i3])).toBeLessThan(0.15);
      // Spread toward the thumb moves the index finger toward the thumb side (−Z).
      const spread = {
        ...HAND_PRESETS.open,
        index: { flex: [0, 0, 0] as [number, number, number], spread: 15 },
      };
      const sp = forwardKinematics(sk, fingerRotations(rig, spread));
      const dir = normalize(sub(sp.positions[i3], rest.positions[i3]));
      expect(dot(dir, [0, 0, -1])).toBeGreaterThan(0.5);
    }
  });

  it('returns null for a model without finger bones', () => {
    expect(fingerRig([{ name: '左手首', parent: -1, position: [0, 0, 0] }], 'left')).toBeNull();
  });
});

describe('finger tracks', () => {
  const obs = (pose: HandPose, side: 'left' | 'right'): HandObs => ({
    score: 0.9,
    handedness: side === 'left' ? 'Right' : 'Left',
    handednessScore: 0.9,
    image: new Array(63).fill(0.5),
    world: toMp(handPoints([0, 0, 0], side === 'left' ? [1, 0, 0] : [-1, 0, 0], [0, 0, -1], side, pose)),
    crop: { x: 0, y: 0, w: 1, h: 1 },
  });

  it('resolves sides from the body wrist, and swaps them for mirrored videos', () => {
    const frames = Array.from({ length: 30 }, (_, i) => ({
      time: i / 30,
      hands: [obs(HAND_PRESETS.fist, 'left'), obs(HAND_PRESETS.open, 'right')] as [HandObs, HandObs],
    }));
    const times = frames.map((f) => f.time);
    const r = computeFingerTracks(frames, times, SETTINGS, { mirror: false, fps: 30 });
    expect(r.presets[0][15]).toBe('fist');
    expect(r.presets[1][15]).toBe('open');
    expect(r.coverage).toEqual([1, 1]);
    expect(r.labelAgreement).toBe(1);
    const m = computeFingerTracks(frames, times, SETTINGS, { mirror: true, fps: 30 });
    expect(m.presets[0][15]).toBe('open');
    // Labels follow the hand's appearance exactly like the body pose does, so mirroring can't flip them.
    expect(m.labelAgreement).toBe(1);
  });

  it('holds the last pose on dropout, then eases to relaxed', () => {
    const frames = Array.from({ length: 90 }, (_, i) => ({
      time: i / 30,
      hands: (i < 30 ? [obs(HAND_PRESETS.fist, 'left'), null] : [null, null]) as [
        HandObs | null,
        HandObs | null,
      ],
    }));
    const r = computeFingerTracks(
      frames,
      frames.map((f) => f.time),
      SETTINGS,
      { mirror: false, fps: 30 },
    );
    expect(r.presets[0][35]).toBe('fist');
    expect(r.presets[0][85]).toBe('relaxed');
    expect(r.coverage[0]).toBeCloseTo(30 / 90, 2);
    expect(r.coverage[1]).toBe(0);
  });
});
