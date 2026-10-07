// Procedural test fixtures (no copyrighted data): deterministic clips for unit tests and e2e.
import { axisAngle, qmul } from '@/lib/math3d';
import type { BoneKey, BoneTrack, CameraKey, MotionClip, Quat, Vec3 } from './types';
import { BONE_CHANNELS, CAMERA_CHANNELS, linearCurves } from './types';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f32 = Math.fround;
const fq = (q: Quat): Quat => [f32(q[0]), f32(q[1]), f32(q[2]), f32(q[3])];
const fv = (v: Vec3): Vec3 => [f32(v[0]), f32(v[1]), f32(v[2])];

/** Random but valid curves (x1 ≤ … bytes 0–127). */
function randomCurves(r: () => number, channels: number): number[] {
  return Array.from({ length: channels * 4 }, () => Math.floor(r() * 128));
}

/** A small dance-like clip: センター, 上半身, arms, 足ＩＫ, a morph, plus camera, light, shadow, IK property keys. */
export function makeClip(
  seed = 1,
  opts: { frames?: number; step?: number; randomCurves?: boolean } = {},
): MotionClip {
  const r = rng(seed);
  const frames = opts.frames ?? 120;
  const step = opts.step ?? 10;
  const bones: BoneTrack[] = [];
  const add = (name: string, fn: (f: number) => { p?: Vec3; r?: Quat }): void => {
    const keys: BoneKey[] = [];
    for (let f = 0; f <= frames; f += step) {
      const v = fn(f);
      keys.push({
        f,
        p: fv(v.p ?? [0, 0, 0]),
        r: fq(v.r ?? [0, 0, 0, 1]),
        ip: opts.randomCurves ? randomCurves(r, BONE_CHANNELS) : linearCurves(BONE_CHANNELS),
      });
    }
    bones.push({ name, keys });
  };
  add('センター', (f) => ({ p: [Math.sin(f / 20) * 2, Math.abs(Math.sin(f / 10)) * 0.5, 0] }));
  add('上半身', (f) => ({ r: axisAngle([0, 1, 0], Math.sin(f / 15) * 0.4) }));
  add('左腕', (f) => ({ r: qmul(axisAngle([0, 0, 1], 0.6), axisAngle([1, 0, 0], Math.sin(f / 12) * 0.5)) }));
  add('右腕', (f) => ({ r: qmul(axisAngle([0, 0, 1], -0.6), axisAngle([1, 0, 0], Math.cos(f / 12) * 0.5)) }));
  add('左足ＩＫ', (f) => ({
    p: [Math.sin(f / 30), Math.max(0, Math.sin(f / 8)) * 0.8, 0],
    r: axisAngle([1, 0, 0], 0.1),
  }));
  const camera: CameraKey[] = [];
  for (let f = 0; f <= frames; f += step * 3) {
    camera.push({
      f,
      t: fv([0, 10 + Math.sin(f / 30), 0]),
      r: fv([0.1, f / 60, 0]),
      d: f32(-30 - f / 10),
      fov: 30 + (f % 20),
      persp: true,
      ip: opts.randomCurves ? randomCurves(r, CAMERA_CHANNELS) : linearCurves(CAMERA_CHANNELS),
    });
  }
  return {
    modelName: 'テストモデル',
    bones,
    morphs: [
      {
        name: 'まばたき',
        keys: [0, 30, 33, 36, 90].map((f, i) => ({ f, w: f32(i % 2 ? 1 : 0) })),
      },
      { name: 'あ', keys: [0, 15, 30].map((f, i) => ({ f, w: f32(i * 0.4) })) },
    ],
    props: [
      { f: 0, visible: true, ik: { 左足ＩＫ: true, 右足ＩＫ: true } },
      { f: 60, visible: true, ik: { 左足ＩＫ: false, 右足ＩＫ: true } },
    ],
    camera,
    lights: [{ f: 0, color: fv([0.6, 0.6, 0.6]), dir: fv([-0.5, -1, 0.5]) }],
    shadows: [{ f: 0, mode: 1, dist: f32(0.0125) }],
  };
}
