// Camera Director math: MMD camera geometry, capture from a viewport view, look-at baking, shots and
// cuts, auto-camera presets on the beat grid, seeded handheld shake and range validation.

import { rotate } from '@/lib/math3d';
import { applyPreset } from './bezier';
import { eulerToQuat } from './curves';
import { sampleCamera, type CameraSample } from './evaluate';
import { rng } from './fixtures';
import { beatFrames, framesPerBeat } from './timing';
import {
  CAMERA_CHANNELS,
  linearCurves,
  type CameraKey,
  type Shot,
  type TimingGrid,
  type Vec3,
} from './types';

const DEG = Math.PI / 180;
export const FOV_RANGE: [number, number] = [1, 125];
export const DISTANCE_LIMIT = 10000;

/** Camera orientation quaternion (babylon-mmd: RotationYawPitchRoll(-ry, -rx, -rz)). */
const orientation = (r: Vec3) => eulerToQuat([-r[0], -r[1], -r[2]]);

/** Eye position of an MMD camera value: target + R · (0, 0, distance). */
export function cameraEye(c: { t: Vec3; r: Vec3; d: number }): Vec3 {
  const o = rotate(orientation(c.r), [0, 0, c.d]);
  return [c.t[0] + o[0], c.t[1] + o[1], c.t[2] + o[2]];
}

/** Viewing direction (unit): R · (0, 0, 1). */
export const cameraForward = (r: Vec3): Vec3 => rotate(orientation(r), [0, 0, 1]);

/**
 * MMD camera value that looks from `eye` at `target` (no roll), with the target `target` and a negative
 * distance (in front, the MMD convention). `unwrapNear` keeps yaw continuous with a previous rotation.
 */
export function cameraFromEyeTarget(
  eye: Vec3,
  target: Vec3,
  roll = 0,
  unwrapNear?: Vec3,
): { t: Vec3; r: Vec3; d: number } {
  const f: Vec3 = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const len = Math.hypot(...f) || 1e-6;
  const n: Vec3 = [f[0] / len, f[1] / len, f[2] / len];
  // f = (sinY cosP, -sinP, cosY cosP) with P = -rx, Y = -ry.
  const pitch = Math.asin(Math.max(-1, Math.min(1, -n[1])));
  const yaw = Math.atan2(n[0], n[2]);
  const r: Vec3 = [-pitch, -yaw, roll];
  if (unwrapNear) r[1] += Math.round((unwrapNear[1] - r[1]) / (2 * Math.PI)) * 2 * Math.PI;
  return { t: [...target], r, d: -len };
}

/** Babylon ArcRotate orbit (alpha, beta, radius around target) → eye position. */
export function orbitEye(target: Vec3, alpha: number, beta: number, radius: number): Vec3 {
  return [
    target[0] + radius * Math.cos(alpha) * Math.sin(beta),
    target[1] + radius * Math.cos(beta),
    target[2] + radius * Math.sin(alpha) * Math.sin(beta),
  ];
}

export const clampFov = (fov: number): number =>
  Math.max(FOV_RANGE[0], Math.min(FOV_RANGE[1], Math.round(fov)));

export function makeCameraKey(
  f: number,
  v: { t: Vec3; r: Vec3; d: number; fov: number },
  ip = linearCurves(CAMERA_CHANNELS),
): CameraKey {
  return { f, t: [...v.t], r: [...v.r], d: v.d, fov: clampFov(v.fov), persp: true, ip };
}

const sortKeys = (keys: CameraKey[]): CameraKey[] => {
  const m = new Map<number, CameraKey>();
  for (const k of keys) m.set(k.f, k);
  return [...m.values()].sort((a, b) => a.f - b.f);
};

/** Frames of cut pairs (a, a + 1) in a key list. */
export const cutFrames = (keys: readonly CameraKey[]): number[] =>
  keys.filter((k, i) => i > 0 && keys[i - 1].f + 1 === k.f).map((k) => k.f);

/**
 * Bake frames for [from, to] every `step` frames that never create accidental cuts: existing cut pairs
 * inside the range are kept as cuts, other keys are at least two frames apart.
 */
function bakeFrames(keys: readonly CameraKey[], from: number, to: number, step: number): number[] {
  const allCuts = new Set(cutFrames(keys));
  const has = (f: number): boolean => keys.some((k) => k.f === f);
  // A baked key right next to a kept key outside the range would form a new cut (unless one existed).
  const blocked = (f: number): boolean =>
    (f === to && has(to + 1) && !allCuts.has(to + 1)) || (f === from && has(from - 1) && !allCuts.has(from));
  // Required: the range ends and both frames of every cut pair inside it.
  const chosen = new Set<number>([from, to].filter((f) => !blocked(f)));
  for (const c of allCuts) {
    if (c <= from || c > to) continue;
    chosen.add(c - 1);
    chosen.add(c);
  }
  for (let f = from; f <= to; f += Math.max(2, step)) {
    if (!blocked(f) && !chosen.has(f - 1) && !chosen.has(f + 1)) chosen.add(f);
  }
  return [...chosen].sort((a, b) => a - b);
}

/** Sample across a cut correctly: the frame before a cut holds the previous shot. */
const sampleAt = (keys: readonly CameraKey[], f: number): CameraSample => {
  // Exactly the key's value on a key frame (the runtime's bezier is ~1e-5 off at x = 0).
  const k = keys.find((x) => x.f === f);
  return k ? { t: [...k.t], r: [...k.r], d: k.d, fov: k.fov } : sampleCamera(keys, f);
};

/**
 * Aim the camera at a moving point over [from, to]: the eye path is kept, rotation / distance / target
 * are rebaked so the point stays centred. `points(f)` gives the point (world) at frame f.
 */
export function bakeLookAt(
  keys: readonly CameraKey[],
  from: number,
  to: number,
  points: (f: number) => Vec3,
  step = 2,
): CameraKey[] {
  if (!keys.length) return [...keys];
  const frames = bakeFrames(keys, from, to, step);
  let prevR: Vec3 | undefined;
  const baked = frames.map((f) => {
    const s = sampleAt(keys, f);
    const eye = cameraEye(s);
    const v = cameraFromEyeTarget(eye, points(f), s.r[2], prevR ?? s.r);
    prevR = v.r;
    return makeCameraKey(f, { ...v, fov: s.fov });
  });
  return sortKeys([...keys.filter((k) => k.f < from || k.f > to), ...baked]);
}

/** Add seeded handheld shake over [from, to]: smooth noise on rotation (degrees) and target. */
export function addShake(
  keys: readonly CameraKey[],
  from: number,
  to: number,
  o: { amplitude?: number; frequency?: number; seed?: number; step?: number } = {},
): CameraKey[] {
  if (!keys.length) return [...keys];
  const amp = o.amplitude ?? 0.6;
  const freq = o.frequency ?? 0.8;
  const r = rng(o.seed ?? 1);
  // Three incommensurate sines per channel = smooth, non-repeating, deterministic.
  const waves = Array.from({ length: 5 }, () =>
    Array.from({ length: 3 }, (_, i) => ({
      ph: r() * Math.PI * 2,
      mul: [1, 1.73, 2.91][i] * (0.8 + r() * 0.4),
    })),
  );
  const noise = (ch: number, f: number): number => {
    const t = (f / 30) * freq * 2 * Math.PI;
    return waves[ch].reduce((s, w, i) => s + Math.sin(t * w.mul + w.ph) / (i + 1), 0) / 1.83;
  };
  const frames = bakeFrames(keys, from, to, o.step ?? 2);
  const baked = frames.map((f) => {
    const s = sampleAt(keys, f);
    // Fade in/out over 10 frames so the range edges don't jump.
    const edge = Math.min(1, (f - from) / 10, (to - f) / 10);
    const a = amp * Math.max(0, edge);
    return makeCameraKey(f, {
      t: [s.t[0] + noise(2, f) * a * 0.05, s.t[1] + noise(3, f) * a * 0.05, s.t[2] + noise(4, f) * a * 0.05],
      r: [s.r[0] + noise(0, f) * a * DEG, s.r[1] + noise(1, f) * a * DEG, s.r[2]],
      d: s.d,
      fov: s.fov,
    });
  });
  return sortKeys([...keys.filter((k) => k.f < from || k.f > to), ...baked]);
}

export interface CameraIssue {
  f: number;
  message: string;
}

/** Values MMD can't represent well: FOV outside 1–125°, zero / huge distance, non-finite numbers. */
export function validateCamera(keys: readonly CameraKey[]): CameraIssue[] {
  const out: CameraIssue[] = [];
  for (const k of keys) {
    if (![...k.t, ...k.r, k.d, k.fov].every(Number.isFinite))
      out.push({ f: k.f, message: 'non-finite value' });
    if (k.fov < FOV_RANGE[0] || k.fov > FOV_RANGE[1] || !Number.isInteger(k.fov))
      out.push({ f: k.f, message: `FOV ${k.fov} outside ${FOV_RANGE[0]}–${FOV_RANGE[1]}° (integer)` });
    if (Math.abs(k.d) < 0.1) out.push({ f: k.f, message: 'distance ~0 (camera on its target)' });
    if (Math.abs(k.d) > DISTANCE_LIMIT) out.push({ f: k.f, message: `distance ${k.d.toFixed(0)} too far` });
  }
  return out;
}

export function clampCamera(keys: readonly CameraKey[]): CameraKey[] {
  return keys.map((k) => {
    const fin = (v: number, fb: number): number => (Number.isFinite(v) ? v : fb);
    let d = fin(k.d, -45);
    if (Math.abs(d) < 0.1) d = d < 0 ? -0.1 : d > 0 ? 0.1 : -0.1;
    d = Math.max(-DISTANCE_LIMIT, Math.min(DISTANCE_LIMIT, d));
    return {
      ...k,
      t: k.t.map((v) => fin(v, 0)) as Vec3,
      r: k.r.map((v) => fin(v, 0)) as Vec3,
      d,
      fov: clampFov(fin(k.fov, 30)),
    };
  });
}

// ---------------------------------------------------------------- shots

const SHOT_COLORS = ['#ffb74d', '#4fc3f7', '#aed581', '#f06292', '#ba68c8', '#4db6ac', '#ffd54f', '#90a4ae'];
export const shotColor = (i: number): string => SHOT_COLORS[i % SHOT_COLORS.length];

/** Sort, rename-free normalisation: shots tile [first.start, last.end] without overlaps. */
export function normalizeShots(shots: readonly Shot[]): Shot[] {
  const s = [...shots].sort((a, b) => a.start - b.start);
  return s.map((sh, i) => ({ ...sh, end: i + 1 < s.length ? Math.min(sh.end, s[i + 1].start - 1) : sh.end }));
}

/** Split the shot containing `at` into [start, at - 1] and [at, end] (the new shot starts with a cut). */
export function splitShot(shots: readonly Shot[], at: number, newId: string): Shot[] {
  const i = shots.findIndex((s) => at > s.start && at <= s.end);
  if (i < 0) return [...shots];
  const s = shots[i];
  const next: Shot = {
    ...s,
    id: newId,
    name: `${s.name}b`,
    start: at,
    end: s.end,
    transition: 'cut',
    color: shotColor(shots.length),
  };
  return normalizeShots([...shots.slice(0, i), { ...s, end: at - 1 }, next, ...shots.slice(i + 1)]);
}

/** Merge a shot with the next one. */
export function mergeShots(shots: readonly Shot[], id: string): Shot[] {
  const s = normalizeShots(shots);
  const i = s.findIndex((x) => x.id === id);
  if (i < 0 || i + 1 >= s.length) return s;
  return [...s.slice(0, i), { ...s[i], end: s[i + 1].end }, ...s.slice(i + 2)];
}

const keysIn = (keys: readonly CameraKey[], a: number, b: number): CameraKey[] =>
  keys.filter((k) => k.f >= a && k.f <= b);

/**
 * The camera keys of one shot as a standalone list (the value at its start is keyed so it plays the
 * same on its own).
 */
function shotKeys(keys: readonly CameraKey[], s: Shot): CameraKey[] {
  const own = keysIn(keys, s.start, s.end);
  if (!own.some((k) => k.f === s.start) && keys.length)
    own.unshift(makeCameraKey(s.start, sampleAt(keys, s.start)));
  if (!own.some((k) => k.f === s.end) && keys.length && keys.some((k) => k.f > s.end))
    own.push(makeCameraKey(s.end, sampleAt(keys, s.end)));
  return own;
}

/**
 * Write shot boundaries into the camera keys: a 'cut' shot gets the MMD cut pair (previous shot held
 * at start - 1, new shot at start); a 'blend' shot interpolates from the previous shot.
 */
export function writeShotBoundaries(keys: readonly CameraKey[], shots: readonly Shot[]): CameraKey[] {
  const s = normalizeShots(shots);
  if (!s.length || !keys.length) return [...keys];
  const per = s.map((sh) => shotKeys(keys, sh));
  const out: CameraKey[] = keys.filter((k) => k.f < s[0].start || k.f > s[s.length - 1].end);
  s.forEach((sh, i) => {
    out.push(...per[i]);
    if (i > 0 && sh.transition === 'cut') {
      const prev = per[i - 1];
      const hold = prev.length ? sampleCamera(prev, sh.start - 1) : sampleAt(keys, sh.start - 1);
      out.push(makeCameraKey(sh.start - 1, hold));
    }
  });
  // Blend shots: drop a cut pair ending at their start.
  const blendStarts = new Set(s.filter((x, i) => i > 0 && x.transition === 'blend').map((x) => x.start));
  const sorted = sortKeys(out);
  return sorted.filter((k, i) => !(blendStarts.has(k.f + 1) && sorted[i + 1]?.f === k.f + 1));
}

/** Move shot `id` to position `to` in the sequence; shot lengths are kept and the keys travel with it. */
export function reorderShot(
  keys: readonly CameraKey[],
  shots: readonly Shot[],
  id: string,
  to: number,
): { keys: CameraKey[]; shots: Shot[] } {
  const s = normalizeShots(shots);
  const i = s.findIndex((x) => x.id === id);
  if (i < 0 || to < 0 || to >= s.length || i === to) return { keys: [...keys], shots: s };
  const per = s.map((sh) => shotKeys(keys, sh).map((k) => ({ ...k, f: k.f - sh.start })));
  const order = s.map((_, k) => k);
  order.splice(to, 0, order.splice(i, 1)[0]);
  let cursor = s[0].start;
  const outShots: Shot[] = [];
  const outKeys: CameraKey[] = keys.filter((k) => k.f < s[0].start || k.f > s[s.length - 1].end);
  for (const k of order) {
    const len = s[k].end - s[k].start;
    outShots.push({ ...s[k], start: cursor, end: cursor + len });
    outKeys.push(...per[k].map((key) => ({ ...key, f: key.f + cursor })));
    cursor += len + 1;
  }
  return { keys: writeShotBoundaries(sortKeys(outKeys), outShots), shots: outShots };
}

/** Delete a shot: its keys go and later shots move up to close the gap. */
export function deleteShot(
  keys: readonly CameraKey[],
  shots: readonly Shot[],
  id: string,
): { keys: CameraKey[]; shots: Shot[] } {
  const s = normalizeShots(shots);
  const sh = s.find((x) => x.id === id);
  if (!sh) return { keys: [...keys], shots: s };
  const len = sh.end - sh.start + 1;
  const outKeys = keys
    .filter((k) => k.f < sh.start || k.f > sh.end)
    .map((k) => (k.f > sh.end ? { ...k, f: k.f - len } : k));
  const outShots = s
    .filter((x) => x.id !== id)
    .map((x) => (x.start > sh.end ? { ...x, start: x.start - len, end: x.end - len } : x));
  return { keys: writeShotBoundaries(outKeys, outShots), shots: outShots };
}

// ---------------------------------------------------------------- presets

export type CameraPreset = 'orbit' | 'dolly-in' | 'crane-up' | 'front-side-cut' | 'face-close-up';

export interface PresetOptions {
  from: number;
  to: number;
  /** Subject point (world), e.g. the centre bone; `face` for close-ups. */
  subject: Vec3;
  face?: Vec3;
  grid?: TimingGrid;
  /** Base distance (positive number, model units). */
  distance?: number;
  fov?: number;
  /** Subject facing yaw (radians): 0 = MMD front (camera at -Z looking +Z... models face -Z). */
  facing?: number;
}

/** Snap a frame to the nearest beat (whole frames) when a grid is set. */
function onBeat(f: number, grid?: TimingGrid): number {
  if (!grid || grid.bpm <= 0) return Math.round(f);
  const step = framesPerBeat(grid.bpm);
  return Math.max(0, Math.round(grid.offset + Math.round((f - grid.offset) / step) * step));
}

/** Frames of beats in [from, to] (or every `fallback` frames without a grid). */
function beatsIn(
  from: number,
  to: number,
  grid: TimingGrid | undefined,
  fallback: number,
  barsOnly = false,
): number[] {
  if (grid && grid.bpm > 0) {
    const b = beatFrames(grid, from, to).filter((x) => !barsOnly || x.bar);
    const fs = [...new Set(b.map((x) => Math.round(x.f)))];
    if (fs.length >= 2) return fs;
  }
  const out: number[] = [];
  for (let f = from; f <= to; f += fallback) out.push(f);
  if (out[out.length - 1] !== to) out.push(to);
  return out;
}

/**
 * Generate camera keys for a preset over [from, to] (start and end snapped to beats). Keys outside the
 * range are kept; cut presets write proper MMD cut pairs on a bar line.
 */
export function generatePreset(
  keys: readonly CameraKey[],
  preset: CameraPreset,
  o: PresetOptions,
): CameraKey[] {
  const from = onBeat(o.from, o.grid);
  let to = onBeat(o.to, o.grid);
  if (to <= from + 2) to = from + 60;
  const dist = o.distance ?? 35;
  const fov = o.fov ?? 30;
  const yaw0 = o.facing ?? 0;
  const subj = o.subject;
  const ease = applyPreset(linearCurves(CAMERA_CHANNELS), 'ease-in-out');
  // Camera in front of the subject: MMD models face -Z, so the camera sits at -Z looking +Z (ry = 0).
  const at = (
    yaw: number,
    pitch: number,
    d: number,
    target: Vec3,
    f: number,
    fv = fov,
    ip = linearCurves(CAMERA_CHANNELS),
  ): CameraKey => makeCameraKey(f, { t: target, r: [pitch, yaw0 + yaw, 0], d: -d, fov: fv }, ip);
  let gen: CameraKey[] = [];
  switch (preset) {
    case 'orbit': {
      const beats = beatsIn(from, to, o.grid, 15);
      gen = beats.map((f) => at(((f - from) / (to - from)) * 2 * Math.PI, 8 * DEG, dist, subj, f));
      break;
    }
    case 'dolly-in':
      gen = [at(0, 5 * DEG, dist * 1.8, subj, from), at(0, 5 * DEG, dist * 0.6, subj, to, fov, ease)];
      break;
    case 'crane-up': {
      const low: Vec3 = [subj[0], subj[1] * 0.4, subj[2]];
      const high: Vec3 = [subj[0], subj[1] * 1.3, subj[2]];
      gen = [at(0, -10 * DEG, dist, low, from), at(0, 30 * DEG, dist * 1.3, high, to, fov, ease)];
      break;
    }
    case 'front-side-cut': {
      const bars = beatsIn(from, to, o.grid, 30, true);
      const cut = bars.find((f) => f > from + (to - from) / 3 && f < to) ?? Math.round((from + to) / 2);
      gen = [
        at(0, 5 * DEG, dist, subj, from),
        at(0, 5 * DEG, dist * 0.9, subj, cut - 1),
        at(Math.PI / 2, 5 * DEG, dist * 0.8, subj, cut),
        at(Math.PI / 2 + 10 * DEG, 5 * DEG, dist * 0.75, subj, to),
      ];
      break;
    }
    case 'face-close-up': {
      const face = o.face ?? [subj[0], subj[1] + 5, subj[2]];
      gen = [at(-6 * DEG, 0, 12, face, from, 22), at(6 * DEG, 2 * DEG, 10, face, to, 22, ease)];
      break;
    }
  }
  // A key right before the range keeps earlier motion from blending into the preset (a cut in).
  const before = keys.filter((k) => k.f < from);
  const after = keys.filter((k) => k.f > to);
  const out = [...before, ...gen, ...after];
  if (before.length && before[before.length - 1].f < from - 1)
    out.push(makeCameraKey(from - 1, sampleAt(keys, from - 1)));
  return sortKeys(out);
}
