import { describe, expect, it } from 'vitest';
import { cleanSequence } from './clean';
import { LM } from './landmarks';
import { add, dist, sub, type Quat, type Vec3 } from './math';
import { forwardKinematics, retarget } from './retarget';
import { BONE, standardSkeleton, type Skeleton } from './skeleton';
import { syntheticFrame } from './synthetic';
import { DEFAULT_SETTINGS, type ConversionSettings, type PoseSequence } from './types';

// Person landmarks (MMD axes, metres, relative to the hip centre) for hands-on-hips ("akimbo"). The dancer
// faces −Z, so their left is +X.
function akimbo(side: 1 | -1): Partial<Record<number, Vec3>> {
  const L = side === 1;
  const x = (v: number): number => v * side;
  return {
    [L ? LM.leftElbow : LM.rightElbow]: [x(0.4), 0.27, 0.06],
    [L ? LM.leftWrist : LM.rightWrist]: [x(0.17), 0.07, -0.02],
    [L ? LM.leftIndex : LM.rightIndex]: [x(0.12), 0.02, -0.06],
    [L ? LM.leftPinky : LM.rightPinky]: [x(0.14), 0.0, 0.0],
    [L ? LM.leftThumb : LM.rightThumb]: [x(0.14), 0.06, -0.06],
  };
}

function sequence(pose: Partial<Record<number, Vec3>>, seconds = 1, fps = 30): PoseSequence {
  const frames = [];
  for (let i = 0; i < seconds * fps; i++) {
    const f = syntheticFrame(0);
    const world = f.world.slice();
    const sh = (i: number): Vec3 => [world[i * 4], -world[i * 4 + 1], world[i * 4 + 2]];
    // Put the shoulders square above the hips so the arm landmarks are relative to a known torso.
    const hip = sh(LM.leftHip)[1];
    for (const [k, v] of Object.entries(pose)) {
      const j = Number(k);
      world[j * 4] = v![0];
      world[j * 4 + 1] = -(v![1] + hip);
      world[j * 4 + 2] = v![2];
    }
    frames.push({ time: i / fps, detected: true, image: f.image, world });
  }
  return {
    version: 1,
    estimator: 'synthetic',
    video: { name: 's', width: 640, height: 360, fps, duration: seconds, hasAudio: false },
    trim: [0, seconds],
    crop: null,
    analysedSize: [640, 360],
    sampleFps: fps,
    frames,
  };
}

/** Anime proportions: narrow shoulders and long forearms relative to the body. */
function animeSkeleton(): Skeleton {
  const sk = standardSkeleton();
  const byName = new Map(sk.bones.map((b) => [b.name, b]));
  for (const s of ['左', '右'] as const) {
    const sign = s === '左' ? 1 : -1;
    const arm = byName.get(`${s}腕`)!;
    const elbow = byName.get(`${s}ひじ`)!;
    const shift: Vec3 = [-0.45 * sign, 0, 0];
    // Move the arm chain in toward the spine, then lengthen the forearm and hand by 40 %.
    for (const b of sk.bones) {
      let p = b.parent;
      let inArm = b === arm;
      while (!inArm && p >= 0) {
        if (sk.bones[p] === arm) inArm = true;
        p = sk.bones[p].parent;
      }
      if (inArm) b.position = add(b.position, shift);
    }
    for (const b of sk.bones) {
      let p = b.parent;
      let inFore = false;
      while (p >= 0) {
        if (sk.bones[p] === elbow) inFore = true;
        p = sk.bones[p].parent;
      }
      if (inFore)
        b.position = add(elbow.position, sub(b.position, elbow.position).map((v) => v * 1.4) as Vec3);
    }
  }
  return sk;
}

function wristsAt(
  sk: Skeleton,
  settings: ConversionSettings,
  pose: Partial<Record<number, Vec3>> = { ...akimbo(1), ...akimbo(-1) },
) {
  const track = cleanSequence(sequence(pose), settings);
  const result = retarget(track, sk, settings);
  const frame = 15;
  const locals = new Map<string, Quat>();
  for (const k of result.keys) if (k.frame === frame) locals.set(k.bone, k.rotation as Quat);
  const { positions } = forwardKinematics(sk, locals);
  const at = (n: string): Vec3 => positions[sk.bones.findIndex((b) => b.name === n)];
  return { at, torso: dist(at(BONE.leg('左')), at(BONE.arm('左'))) };
}

describe('hand contact', () => {
  for (const [name, make] of [
    ['standard', standardSkeleton],
    ['anime proportions', animeSkeleton],
  ] as const) {
    it(`keeps hands on the hips, on their own side (${name})`, () => {
      const sk = make();
      const { at, torso } = wristsAt(sk, DEFAULT_SETTINGS);
      for (const s of ['左', '右'] as const) {
        const w = at(BONE.wrist(s));
        const hip = at(BONE.leg(s));
        const sign = s === '左' ? 1 : -1;
        // Beside the hip joint (not crossing to the front of the body)...
        expect(w[0] * sign, `${s} wrist x`).toBeGreaterThan(Math.abs(hip[0]) * 0.9);
        // ...close to it...
        expect(dist(w, hip) / torso, `${s} wrist-hip`).toBeLessThan(0.4);
        // ...and not far in front of the body.
        expect(hip[2] - w[2], `${s} wrist forward`).toBeLessThan(0.15 * torso);
      }
    });
  }

  it('reproduces the crossing hands without it (the bug this fixes)', () => {
    const { at } = wristsAt(animeSkeleton(), { ...DEFAULT_SETTINGS, handContact: 0 });
    expect(at(BONE.wrist('左'))[0]).toBeLessThan(Math.abs(at(BONE.leg('左'))[0]) * 0.9);
  });

  it('leaves hands away from the body alone', () => {
    // Arms out to the sides.
    const out = (side: 1 | -1): Partial<Record<number, Vec3>> => {
      const L = side === 1;
      return {
        [L ? LM.leftElbow : LM.rightElbow]: [0.47 * side, 0.48, 0],
        [L ? LM.leftWrist : LM.rightWrist]: [0.72 * side, 0.46, 0],
        [L ? LM.leftIndex : LM.rightIndex]: [0.8 * side, 0.45, -0.02],
        [L ? LM.leftPinky : LM.rightPinky]: [0.79 * side, 0.45, 0.02],
        [L ? LM.leftThumb : LM.rightThumb]: [0.76 * side, 0.47, -0.03],
      };
    };
    const pose = { ...out(1), ...out(-1) };
    const sk = animeSkeleton();
    const on = wristsAt(sk, DEFAULT_SETTINGS, pose).at(BONE.wrist('左'));
    const off = wristsAt(sk, { ...DEFAULT_SETTINGS, handContact: 0 }, pose).at(BONE.wrist('左'));
    expect(dist(on, off)).toBeLessThan(1e-6);
  });
});
