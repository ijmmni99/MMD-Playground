import { qnormalize, slerp } from '@/lib/math3d';
import { curveWeight } from './bezier';
import type { BoneKey, BoneTrack, CameraKey, MorphTrack, Quat, Vec3 } from './types';

/** Index of the first key with frame > `frame` (keys sorted by frame). */
export function upperBound<T extends { f: number }>(keys: readonly T[], frame: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].f <= frame) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the key exactly at `frame`, or -1. */
export function keyIndexAt<T extends { f: number }>(keys: readonly T[], frame: number): number {
  const i = upperBound(keys, frame) - 1;
  return i >= 0 && keys[i].f === frame ? i : -1;
}

export interface BoneSample {
  p: Vec3;
  r: Quat;
}

/** Bone value at a (fractional) frame, exactly as babylon-mmd evaluates it. */
export function sampleBone(keys: readonly BoneKey[], frame: number): BoneSample {
  if (!keys.length) return { p: [0, 0, 0], r: [0, 0, 0, 1] };
  const ub = upperBound(keys, frame);
  if (ub === 0) return { p: [...keys[0].p], r: [...keys[0].r] };
  if (ub >= keys.length) {
    const k = keys[keys.length - 1];
    return { p: [...k.p], r: [...k.r] };
  }
  const a = keys[ub - 1];
  const b = keys[ub];
  const x = (frame - a.f) / (b.f - a.f);
  const p: Vec3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) p[c] = a.p[c] + (b.p[c] - a.p[c]) * curveWeight(b.ip, c, x);
  const r = qnormalize(slerp(a.r, b.r, curveWeight(b.ip, 3, x)));
  return { p, r };
}

export const sampleBoneTrack = (t: BoneTrack, frame: number): BoneSample => sampleBone(t.keys, frame);

/** Morph weight at a frame (linear between keys). */
export function sampleMorph(t: MorphTrack, frame: number): number {
  const keys = t.keys;
  if (!keys.length) return 0;
  const ub = upperBound(keys, frame);
  if (ub === 0) return keys[0].w;
  if (ub >= keys.length) return keys[keys.length - 1].w;
  const a = keys[ub - 1];
  const b = keys[ub];
  return a.w + (b.w - a.w) * ((frame - a.f) / (b.f - a.f));
}

export interface CameraSample {
  t: Vec3;
  r: Vec3;
  d: number;
  fov: number;
}

/** Camera at a frame. Keys on consecutive frames are a cut: the earlier key holds (MMD semantics). */
export function sampleCamera(keys: readonly CameraKey[], frame: number): CameraSample {
  if (!keys.length) return { t: [0, 10, 0], r: [0, 0, 0], d: -45, fov: 30 };
  const ub = upperBound(keys, frame);
  const hold = (k: CameraKey): CameraSample => ({ t: [...k.t], r: [...k.r], d: k.d, fov: k.fov });
  if (ub === 0) return hold(keys[0]);
  if (ub >= keys.length) return hold(keys[keys.length - 1]);
  const a = keys[ub - 1];
  const b = keys[ub];
  if (a.f + 1 === b.f) return hold(a);
  const x = (frame - a.f) / (b.f - a.f);
  const lerp = (u: number, v: number, w: number): number => u + (v - u) * w;
  const t: Vec3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) t[c] = lerp(a.t[c], b.t[c], curveWeight(b.ip, c, x));
  const rw = curveWeight(b.ip, 3, x);
  const r: Vec3 = [lerp(a.r[0], b.r[0], rw), lerp(a.r[1], b.r[1], rw), lerp(a.r[2], b.r[2], rw)];
  return {
    t,
    r,
    d: lerp(a.d, b.d, curveWeight(b.ip, 4, x)),
    fov: lerp(a.fov, b.fov, curveWeight(b.ip, 5, x)),
  };
}

/** Last keyed frame across a clip's tracks. */
export function clipEndFrame(clip: {
  bones: BoneTrack[];
  morphs: MorphTrack[];
  camera: CameraKey[];
}): number {
  let end = 0;
  for (const t of clip.bones) end = Math.max(end, t.keys[t.keys.length - 1]?.f ?? 0);
  for (const t of clip.morphs) end = Math.max(end, t.keys[t.keys.length - 1]?.f ?? 0);
  end = Math.max(end, clip.camera[clip.camera.length - 1]?.f ?? 0);
  return end;
}
