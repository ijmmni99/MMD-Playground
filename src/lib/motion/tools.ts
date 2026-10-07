// Motion tools: whole-clip / range operations (time, mirror, smoothing, reduction, blending, scale, face).
// All pure: they take a clip and return a new one, replacing only the tracks they change.

import { axisAngle, qconj, qdot, qmul, qneg, qnormalize, slerp, QI } from '@/lib/math3d';
import { quatContinuity } from './curves';
import { sampleBone, sampleCamera, sampleMorph, upperBound } from './evaluate';
import { rng } from './fixtures';
import {
  BONE_CHANNELS,
  linearCurves,
  type BoneKey,
  type BoneTrack,
  type CameraKey,
  type MorphKey,
  type MorphTrack,
  type MotionClip,
  type Quat,
  type Vec3,
} from './types';

/** Which tracks a tool touches. Absent = all bones / morphs; camera only when `camera` is true. */
export interface Scope {
  bones?: readonly string[];
  morphs?: readonly string[] | boolean;
  camera?: boolean;
}

const inBones = (scope: Scope, name: string): boolean => !scope.bones || scope.bones.includes(name);
const inMorphs = (scope: Scope, name: string): boolean =>
  scope.morphs === undefined ||
  scope.morphs === true ||
  (Array.isArray(scope.morphs) && scope.morphs.includes(name));

/** Sort by frame; for duplicate frames the last one wins. */
function normalizeKeys<T extends { f: number }>(keys: T[]): T[] {
  const m = new Map<number, T>();
  for (const k of keys) m.set(k.f, k);
  return [...m.values()].sort((a, b) => a.f - b.f);
}

type Mapper = <T extends { f: number }>(
  keys: readonly T[],
  kind: 'bone' | 'morph' | 'camera' | 'other',
) => T[];

/** Apply a key-list transform to every in-scope track (property/light/shadow keys follow when `all`). */
function mapAll(clip: MotionClip, scope: Scope, fn: Mapper, all = false): MotionClip {
  return {
    ...clip,
    bones: clip.bones
      .map((t) => (inBones(scope, t.name) ? { ...t, keys: normalizeKeys(fn(t.keys, 'bone')) } : t))
      .filter((t) => t.keys.length),
    morphs: clip.morphs
      .map((t) => (inMorphs(scope, t.name) ? { ...t, keys: normalizeKeys(fn(t.keys, 'morph')) } : t))
      .filter((t) => t.keys.length),
    camera: scope.camera ? normalizeKeys(fn(clip.camera, 'camera')) : clip.camera,
    props: all ? normalizeKeys(fn(clip.props, 'other')) : clip.props,
    lights: all ? normalizeKeys(fn(clip.lights, 'other')) : clip.lights,
    shadows: all ? normalizeKeys(fn(clip.shadows, 'other')) : clip.shadows,
  };
}

// ---------------------------------------------------------------- sampling helpers

const boneKeyAt = (keys: readonly BoneKey[], f: number, ip = linearCurves(BONE_CHANNELS)): BoneKey => {
  const s = sampleBone(keys, f);
  return { f, p: s.p, r: s.r, ip };
};

/** A key holding the exact sampled value at `f` (keeps the original key there, if any). */
function keyAtFrame<T extends { f: number }>(keys: readonly T[], f: number, kind: string): T | null {
  if (!keys.length) return null;
  const ex = keys.find((k) => k.f === f);
  if (ex) return ex;
  if (kind === 'bone') return boneKeyAt(keys as unknown as BoneKey[], f) as unknown as T;
  if (kind === 'morph')
    return { f, w: sampleMorph({ name: '', keys: keys as unknown as MorphKey[] }, f) } as unknown as T;
  if (kind === 'camera') {
    const c = sampleCamera(keys as unknown as CameraKey[], f);
    const prev = (keys as unknown as CameraKey[])[Math.max(0, upperBound(keys, f) - 1)];
    return { f, t: c.t, r: c.r, d: c.d, fov: c.fov, persp: prev.persp, ip: linearCurves(6) } as unknown as T;
  }
  // Discrete keys (properties, light, shadow): the state in effect.
  const i = upperBound(keys, f) - 1;
  return { ...keys[Math.max(0, i)], f };
}

// ---------------------------------------------------------------- time

/** Keep [from, to], move `from` to frame 0. Boundary values are preserved by keys at both ends. */
export function trim(clip: MotionClip, from: number, to: number): MotionClip {
  return mapAll(
    clip,
    { camera: true },
    (keys, kind) => {
      if (!keys.length) return [];
      const a = keyAtFrame(keys, from, kind);
      const b = kind === 'other' ? null : keyAtFrame(keys, to, kind);
      const mid = keys.filter((k) => k.f > from && k.f < to);
      return [a, ...mid, b]
        .filter((k): k is NonNullable<typeof k> => !!k)
        .map((k) => ({ ...k, f: k.f - from }));
    },
    true,
  );
}

/** Insert `count` empty frames at `at` (keys at or after it move later). */
export function insertTime(clip: MotionClip, at: number, count: number): MotionClip {
  return mapAll(
    clip,
    { camera: true },
    (keys) => keys.map((k) => (k.f >= at ? { ...k, f: k.f + count } : k)),
    true,
  );
}

/** Delete frames [from, to): keys inside go, later keys move earlier; the value at `to` is kept. */
export function deleteTime(clip: MotionClip, from: number, to: number): MotionClip {
  const n = to - from;
  if (n <= 0) return clip;
  return mapAll(
    clip,
    { camera: true },
    (keys, kind) => {
      if (!keys.length) return [];
      const atTo = keyAtFrame(keys, to, kind);
      const out = keys
        .filter((k) => k.f < from || k.f > to)
        .map((k) => (k.f > to ? { ...k, f: k.f - n } : k));
      if (atTo) out.push({ ...atTo, f: from });
      return out;
    },
    true,
  );
}

/**
 * Scale timing of [from, to] by `factor` around `from`; later keys shift. Camera cuts (keys on
 * consecutive frames) stay cuts.
 */
export function retime(
  clip: MotionClip,
  from: number,
  to: number,
  factor: number,
  scope: Scope = { camera: true },
): MotionClip {
  const shift = Math.round((to - from) * factor) - (to - from);
  const map = (f: number): number =>
    f < from ? f : f <= to ? Math.round(from + (f - from) * factor) : f + shift;
  return mapAll(
    clip,
    scope,
    (keys, kind) => {
      const out = keys.map((k) => ({ ...k, f: map(k.f) }));
      if (kind === 'camera') {
        for (let i = 1; i < out.length; i++) {
          if (keys[i - 1].f + 1 === keys[i].f) out[i] = { ...out[i], f: out[i - 1].f + 1 };
        }
      }
      // Collapsing keys onto one frame: keep the later one (normalizeKeys); nothing moves before 0.
      return out.map((k) => (k.f < 0 ? { ...k, f: 0 } : k));
    },
    scope.camera === true && !scope.bones,
  );
}

/**
 * Repeat [from, to) `times` times in total (later keys shift). With `blend` > 0 the last `blend` frames
 * of each repetition ease into the loop start so the seam doesn't pop.
 */
export function loop(clip: MotionClip, from: number, to: number, times: number, blend = 0): MotionClip {
  const len = to - from;
  if (len <= 0 || times <= 1) return clip;
  const extra = (times - 1) * len;
  const seamed = blend > 0 ? blendSeam(clip, from, to, Math.min(blend, len)) : clip;
  return mapAll(
    seamed,
    { camera: true },
    (keys, kind) => {
      if (!keys.length) return [];
      const atFrom = keyAtFrame(keys, from, kind);
      const seg = keys.filter((k) => k.f >= from && k.f < to);
      if (atFrom && !seg.some((k) => k.f === from)) seg.unshift(atFrom);
      const out = keys.filter((k) => k.f < to);
      for (let r = 1; r < times; r++) for (const k of seg) out.push({ ...k, f: k.f + r * len });
      // The original key at `to` (or the end state) closes the last repetition.
      const atTo = keyAtFrame(keys, to, kind);
      for (const k of keys) if (k.f > to) out.push({ ...k, f: k.f + extra });
      if (atTo) out.push({ ...atTo, f: to + extra });
      return out;
    },
    true,
  );
}

const smoothstep = (x: number): number => x * x * (3 - 2 * x);

/** Bake [to - n, to] so the value at `to` equals the value at `from` (rotation/position deltas eased in). */
function blendSeam(clip: MotionClip, from: number, to: number, n: number): MotionClip {
  const start = to - n;
  return {
    ...clip,
    bones: clip.bones.map((t) => {
      const a = sampleBone(t.keys, from);
      const b = sampleBone(t.keys, to);
      const dp: Vec3 = [a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]];
      let dq = qnormalize(qmul(a.r, qconj(b.r)));
      if (dq[3] < 0) dq = qneg(dq);
      if (Math.abs(dq[3]) > 0.999999 && Math.hypot(...dp) < 1e-6) return t;
      const baked: BoneKey[] = [];
      for (let f = start; f <= to; f++) {
        const s = sampleBone(t.keys, f);
        const w = smoothstep((f - start) / n);
        baked.push({
          f,
          p: [s.p[0] + dp[0] * w, s.p[1] + dp[1] * w, s.p[2] + dp[2] * w],
          r: qnormalize(qmul(slerp(QI, dq, w), s.r)),
          ip: linearCurves(BONE_CHANNELS),
        });
      }
      return { ...t, keys: normalizeKeys([...t.keys.filter((k) => k.f < start || k.f > to), ...baked]) };
    }),
    morphs: clip.morphs.map((t) => {
      const a = sampleMorph(t, from);
      const b = sampleMorph(t, to);
      if (Math.abs(a - b) < 1e-6) return t;
      const baked: MorphKey[] = [];
      for (let f = start; f <= to; f++)
        baked.push({ f, w: sampleMorph(t, f) + (a - b) * smoothstep((f - start) / n) });
      return { ...t, keys: normalizeKeys([...t.keys.filter((k) => k.f < start || k.f > to), ...baked]) };
    }),
  };
}

// ---------------------------------------------------------------- mirror

const SIDE_PAIRS: [string, string][] = [
  ['左', '右'],
  ['_L', '_R'],
  ['.L', '.R'],
  ['Left', 'Right'],
];

/** The opposite-side bone name (左腕 ↔ 右腕, 左足ＩＫ ↔ 右足ＩＫ, …), or the name itself. */
export function mirrorName(name: string): string {
  for (const [l, r] of SIDE_PAIRS) {
    if (name.includes(l)) return name.replace(l, r);
    if (name.includes(r)) return name.replace(r, l);
  }
  return name;
}

/** Mirror a bone transform across the model's X = 0 plane (MMD local axes are parallel to world). */
export const mirrorPos = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
export const mirrorQuat = (q: Quat): Quat => [q[0], -q[1], -q[2], q[3]];

/**
 * Mirror the pose left ↔ right (names swapped, X flipped — IK targets included) for keys in [from, to]
 * (default: all). Camera mirrors when `scope.camera`.
 */
export function mirror(clip: MotionClip, scope: Scope = {}, from = -Infinity, to = Infinity): MotionClip {
  const inRange = (f: number): boolean => f >= from && f <= to;
  const byName = new Map(clip.bones.map((t) => [t.name, t]));
  const names = new Set(clip.bones.map((t) => t.name));
  for (const t of clip.bones) if (inBones(scope, t.name)) names.add(mirrorName(t.name));
  const bones: BoneTrack[] = [];
  for (const name of names) {
    const own = byName.get(name);
    const src = byName.get(mirrorName(name));
    if (!inBones(scope, name) && !(src && inBones(scope, src.name))) {
      if (own) bones.push(own);
      continue;
    }
    const keep = (own?.keys ?? []).filter((k) => !inRange(k.f));
    const flipped = (src?.keys ?? [])
      .filter((k) => inRange(k.f))
      .map((k) => ({ ...k, p: mirrorPos(k.p), r: mirrorQuat(k.r) }));
    const keys = normalizeKeys([...keep, ...flipped]);
    if (keys.length) bones.push({ name, keys });
  }
  // Keep the original track order (new mirrored tracks last).
  const order = new Map(clip.bones.map((t, i) => [t.name, i]));
  bones.sort((a, b) => (order.get(a.name) ?? 1e9) - (order.get(b.name) ?? 1e9));
  const camera = scope.camera
    ? clip.camera.map((k) =>
        inRange(k.f)
          ? { ...k, t: [-k.t[0], k.t[1], k.t[2]] as Vec3, r: [k.r[0], -k.r[1], -k.r[2]] as Vec3 }
          : k,
      )
    : clip.camera;
  // Property keys: swap IK enable states too.
  const props = clip.props.map((k) =>
    inRange(k.f)
      ? {
          ...k,
          ik: Object.fromEntries(
            Object.entries(k.ik).map(([n, v]) => [inBones(scope, n) ? mirrorName(n) : n, v]),
          ),
        }
      : k,
  );
  return { ...clip, bones, camera, props };
}

// ---------------------------------------------------------------- smoothing, baking, reduction

export type SmoothMethod = 'gaussian' | 'one-euro';

export interface SmoothOptions {
  method: SmoothMethod;
  /** Gaussian: sigma in frames. One Euro: min cutoff (Hz) — lower = smoother. */
  strength: number;
  /** One Euro speed coefficient. */
  beta?: number;
}

function gaussian(xs: number[], sigma: number): number[] {
  if (sigma <= 0) return xs;
  const r = Math.ceil(sigma * 3);
  const w = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  return xs.map((_, i) => {
    let s = 0;
    let ws = 0;
    for (let j = -r; j <= r; j++) {
      // Clamp at the edges: the range ends keep their values (no drift toward zero).
      const v = xs[Math.min(xs.length - 1, Math.max(0, i + j))];
      s += v * w[j + r];
      ws += w[j + r];
    }
    return s / ws;
  });
}

/** One Euro filter (Casiez et al.), run forward and backward so there's no lag. */
function oneEuro(xs: number[], minCutoff: number, beta: number): number[] {
  const rate = 30;
  const alpha = (cutoff: number): number => {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau * rate);
  };
  const pass = (v: number[]): number[] => {
    const out = [...v];
    let dx = 0;
    for (let i = 1; i < v.length; i++) {
      const d = (v[i] - out[i - 1]) * rate;
      dx += alpha(1) * (d - dx);
      const a = alpha(minCutoff + beta * Math.abs(dx));
      out[i] = out[i - 1] + a * (v[i] - out[i - 1]);
    }
    return out;
  };
  return pass(pass(xs).reverse()).reverse();
}

const filter = (xs: number[], o: SmoothOptions): number[] =>
  o.method === 'gaussian'
    ? gaussian(xs, o.strength)
    : oneEuro(xs, Math.max(0.05, o.strength), o.beta ?? 0.05);

const frameRange = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let f = Math.ceil(from); f <= to; f++) out.push(f);
  return out;
};

/** Sample tracks every `step` frames over [from, to] (linear curves); keys outside stay. */
export function bake(clip: MotionClip, from: number, to: number, scope: Scope = {}, step = 1): MotionClip {
  const frames = frameRange(from, to).filter(
    (f) => (f - Math.ceil(from)) % step === 0 || f === Math.floor(to),
  );
  return {
    ...clip,
    bones: clip.bones.map((t) =>
      inBones(scope, t.name) && t.keys.length
        ? {
            ...t,
            keys: normalizeKeys([
              ...t.keys.filter((k) => k.f < from || k.f > to),
              ...frames.map((f) => boneKeyAt(t.keys, f)),
            ]),
          }
        : t,
    ),
    morphs: clip.morphs.map((t) =>
      inMorphs(scope, t.name) && t.keys.length
        ? {
            ...t,
            keys: normalizeKeys([
              ...t.keys.filter((k) => k.f < from || k.f > to),
              ...frames.map((f) => ({ f, w: sampleMorph(t, f) })),
            ]),
          }
        : t,
    ),
  };
}

/** Quaternion-safe smoothing of [from, to] (baked every frame; hemisphere-aligned before filtering). */
export function smooth(
  clip: MotionClip,
  from: number,
  to: number,
  opts: SmoothOptions,
  scope: Scope = {},
): MotionClip {
  const frames = frameRange(from, to);
  if (frames.length < 3) return clip;
  const bones = clip.bones.map((t): BoneTrack => {
    if (!inBones(scope, t.name) || t.keys.length < 2) return t;
    const samples = frames.map((f) => sampleBone(t.keys, f));
    const qs = quatContinuity(samples.map((s) => s.r));
    const p = [0, 1, 2].map((c) =>
      filter(
        samples.map((s) => s.p[c]),
        opts,
      ),
    );
    const moving = t.keys.some((k) => k.p.some((v) => v !== 0));
    const r = [0, 1, 2, 3].map((c) =>
      filter(
        qs.map((q) => q[c]),
        opts,
      ),
    );
    const baked = frames.map((f, i): BoneKey => ({
      f,
      p: moving ? [p[0][i], p[1][i], p[2][i]] : [0, 0, 0],
      r: qnormalize([r[0][i], r[1][i], r[2][i], r[3][i]]),
      ip: linearCurves(BONE_CHANNELS),
    }));
    return { ...t, keys: normalizeKeys([...t.keys.filter((k) => k.f < from || k.f > to), ...baked]) };
  });
  const morphs = clip.morphs.map((t): MorphTrack => {
    if (!inMorphs(scope, t.name) || t.keys.length < 2) return t;
    const w = filter(
      frames.map((f) => sampleMorph(t, f)),
      opts,
    );
    return {
      ...t,
      keys: normalizeKeys([
        ...t.keys.filter((k) => k.f < from || k.f > to),
        ...frames.map((f, i) => ({ f, w: w[i] })),
      ]),
    };
  });
  return { ...clip, bones, morphs };
}

export interface ReduceOptions {
  /** Max position error (model units). */
  pos: number;
  /** Max rotation error (degrees). */
  rot: number;
  /** Max morph weight error. */
  morph?: number;
}

const quatAngleDeg = (a: Quat, b: Quat): number =>
  (2 * Math.acos(Math.min(1, Math.abs(qdot(a, b)))) * 180) / Math.PI;

/** Douglas–Peucker over key lists: keeps keys whose removal would exceed the tolerance (linear curves). */
function dpIndices(n: number, err: (a: number, b: number, i: number) => number, tol: number): Set<number> {
  const keep = new Set<number>([0, n - 1]);
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let wi = -1;
    for (let i = a + 1; i < b; i++) {
      const e = err(a, b, i);
      if (e > worst) {
        worst = e;
        wi = i;
      }
    }
    if (wi >= 0 && worst > tol) {
      keep.add(wi);
      stack.push([a, wi], [wi, b]);
    }
  }
  return keep;
}

/** Remove redundant keys in [from, to] within tolerance. */
export function reduce(
  clip: MotionClip,
  from: number,
  to: number,
  tol: ReduceOptions,
  scope: Scope = {},
): MotionClip {
  const bones = clip.bones.map((t): BoneTrack => {
    if (!inBones(scope, t.name)) return t;
    const inside = t.keys.filter((k) => k.f >= from && k.f <= to);
    if (inside.length < 3) return t;
    const err = (a: number, b: number, i: number): number => {
      const ka = inside[a];
      const kb = inside[b];
      const x = (inside[i].f - ka.f) / (kb.f - ka.f);
      const p = [0, 1, 2].map((c) => ka.p[c] + (kb.p[c] - ka.p[c]) * x);
      const dp = Math.hypot(p[0] - inside[i].p[0], p[1] - inside[i].p[1], p[2] - inside[i].p[2]);
      const dr = quatAngleDeg(slerp(ka.r, kb.r, x), inside[i].r);
      // Normalise both errors to the tolerance so one threshold (1) applies.
      return Math.max(dp / Math.max(1e-9, tol.pos), dr / Math.max(1e-9, tol.rot));
    };
    const keep = dpIndices(inside.length, err, 1);
    const kept = inside
      .filter((_, i) => keep.has(i))
      .map((k, i, arr) =>
        i > 0 && inside.indexOf(k) - inside.indexOf(arr[i - 1]) > 1
          ? { ...k, ip: linearCurves(BONE_CHANNELS) }
          : k,
      );
    return { ...t, keys: normalizeKeys([...t.keys.filter((k) => k.f < from || k.f > to), ...kept]) };
  });
  const mt = tol.morph ?? 0.01;
  const morphs = clip.morphs.map((t): MorphTrack => {
    if (!inMorphs(scope, t.name)) return t;
    const inside = t.keys.filter((k) => k.f >= from && k.f <= to);
    if (inside.length < 3) return t;
    const keep = dpIndices(
      inside.length,
      (a, b, i) => {
        const x = (inside[i].f - inside[a].f) / (inside[b].f - inside[a].f);
        return Math.abs(inside[a].w + (inside[b].w - inside[a].w) * x - inside[i].w) / mt;
      },
      1,
    );
    return {
      ...t,
      keys: normalizeKeys([
        ...t.keys.filter((k) => k.f < from || k.f > to),
        ...inside.filter((_, i) => keep.has(i)),
      ]),
    };
  });
  return { ...clip, bones, morphs };
}

// ---------------------------------------------------------------- offset / scale

export interface OffsetOptions {
  /** Position offset added to keys. */
  pos?: Vec3;
  /** Rotation offset (axis-angle pre-multiplied): Euler XYZ in degrees, applied as X then Y then Z. */
  rotDeg?: Vec3;
  /** Amplitude scale (position × s, rotation angle × s). */
  scale?: number;
  /** Frames over which the effect fades in before `from` and out after `to`. */
  falloff?: number;
}

/** Weight of a range edit at frame f with linear falloff outside [from, to]. */
export function falloffWeight(f: number, from: number, to: number, falloff: number): number {
  if (f >= from && f <= to) return 1;
  if (falloff <= 0) return 0;
  const d = f < from ? from - f : f - to;
  return d >= falloff ? 0 : smoothstep(1 - d / falloff);
}

const qpow = (q: Quat, s: number): Quat => {
  const qq = q[3] < 0 ? qneg(q) : q;
  const angle = 2 * Math.acos(Math.min(1, qq[3]));
  const sn = Math.sqrt(Math.max(0, 1 - qq[3] * qq[3]));
  if (sn < 1e-8) return QI;
  return axisAngle([qq[0] / sn, qq[1] / sn, qq[2] / sn], angle * s);
};

export function offsetScale(
  clip: MotionClip,
  from: number,
  to: number,
  o: OffsetOptions,
  scope: Scope = {},
): MotionClip {
  const fall = o.falloff ?? 0;
  const deg = Math.PI / 180;
  const rd = o.rotDeg ?? [0, 0, 0];
  const dq = qmul(
    axisAngle([0, 0, 1], rd[2] * deg),
    qmul(axisAngle([0, 1, 0], rd[1] * deg), axisAngle([1, 0, 0], rd[0] * deg)),
  );
  const dp = o.pos ?? [0, 0, 0];
  const s = o.scale ?? 1;
  return {
    ...clip,
    bones: clip.bones.map((t) => {
      if (!inBones(scope, t.name)) return t;
      let changed = false;
      const keys = t.keys.map((k) => {
        const w = falloffWeight(k.f, from, to, fall);
        if (w <= 0) return k;
        changed = true;
        const sw = 1 + (s - 1) * w;
        return {
          ...k,
          p: [k.p[0] * sw + dp[0] * w, k.p[1] * sw + dp[1] * w, k.p[2] * sw + dp[2] * w] as Vec3,
          r: qnormalize(qmul(slerp(QI, dq, w), qpow(k.r, sw))),
        };
      });
      return changed ? { ...t, keys } : t;
    }),
  };
}

/** Scale all translations (and optionally camera target / distance) for a differently sized model. */
export function retargetScale(clip: MotionClip, factor: number, withCamera = false): MotionClip {
  return {
    ...clip,
    bones: clip.bones.map((t) =>
      t.keys.some((k) => k.p.some((v) => v !== 0))
        ? {
            ...t,
            keys: t.keys.map((k) => ({
              ...k,
              p: [k.p[0] * factor, k.p[1] * factor, k.p[2] * factor] as Vec3,
            })),
          }
        : t,
    ),
    camera: withCamera
      ? clip.camera.map((k) => ({
          ...k,
          t: [k.t[0] * factor, k.t[1] * factor, k.t[2] * factor] as Vec3,
          d: k.d * factor,
        }))
      : clip.camera,
  };
}

// ---------------------------------------------------------------- blending

/**
 * Crossfade from `a` to `b`: `a` until `at`, a per-frame blend over `length` frames, then `b`.
 * `b` is placed so its frame 0 lands on `bStart` (default `at`).
 */
export function crossfade(a: MotionClip, b: MotionClip, at: number, length: number, bStart = at): MotionClip {
  const end = at + Math.max(1, length);
  const names = new Set([...a.bones.map((t) => t.name), ...b.bones.map((t) => t.name)]);
  const bones: BoneTrack[] = [];
  for (const name of names) {
    const ka = a.bones.find((t) => t.name === name)?.keys ?? [];
    const kb = b.bones.find((t) => t.name === name)?.keys ?? [];
    const keys: BoneKey[] = [...ka.filter((k) => k.f < at)];
    for (let f = at; f <= end; f++) {
      const w = smoothstep((f - at) / (end - at));
      const sa = sampleBone(ka, f);
      const sb = sampleBone(kb, f - bStart);
      keys.push({
        f,
        p: [0, 1, 2].map((c) => sa.p[c] + (sb.p[c] - sa.p[c]) * w) as Vec3,
        r: qnormalize(slerp(sa.r, sb.r, w)),
        ip: linearCurves(BONE_CHANNELS),
      });
    }
    for (const k of kb) if (k.f + bStart > end) keys.push({ ...k, f: k.f + bStart });
    bones.push({ name, keys: normalizeKeys(keys) });
  }
  const mnames = new Set([...a.morphs.map((t) => t.name), ...b.morphs.map((t) => t.name)]);
  const morphs: MorphTrack[] = [];
  for (const name of mnames) {
    const ta: MorphTrack = a.morphs.find((t) => t.name === name) ?? { name, keys: [] };
    const tb: MorphTrack = b.morphs.find((t) => t.name === name) ?? { name, keys: [] };
    const keys: MorphKey[] = ta.keys.filter((k) => k.f < at);
    for (let f = at; f <= end; f++) {
      const w = smoothstep((f - at) / (end - at));
      keys.push({ f, w: sampleMorph(ta, f) * (1 - w) + sampleMorph(tb, f - bStart) * w });
    }
    for (const k of tb.keys) if (k.f + bStart > end) keys.push({ ...k, f: k.f + bStart });
    morphs.push({ name, keys: normalizeKeys(keys) });
  }
  return { ...a, bones, morphs };
}

/**
 * Additive layer: rotations of `layer` (scaled by `weight`) are applied on top of `base`, positions are
 * added. Tracks in both are baked every frame over the layer's span; others are copied.
 */
export function additive(base: MotionClip, layer: MotionClip, weight = 1, offset = 0): MotionClip {
  const bones = base.bones.map((t) => ({ ...t }));
  for (const lt of layer.bones) {
    if (!lt.keys.length) continue;
    const i = bones.findIndex((t) => t.name === lt.name);
    const lf = lt.keys[0].f + offset;
    const ll = lt.keys[lt.keys.length - 1].f + offset;
    const baseKeys = i >= 0 ? bones[i].keys : [];
    const keys: BoneKey[] = baseKeys.filter((k) => k.f < lf || k.f > ll);
    for (let f = lf; f <= ll; f++) {
      const sb = sampleBone(baseKeys, f);
      const sl = sampleBone(lt.keys, f - offset);
      keys.push({
        f,
        p: [0, 1, 2].map((c) => sb.p[c] + sl.p[c] * weight) as Vec3,
        r: qnormalize(qmul(qpow(sl.r, weight), sb.r)),
        ip: linearCurves(BONE_CHANNELS),
      });
    }
    const track = { name: lt.name, keys: normalizeKeys(keys) };
    if (i >= 0) bones[i] = track;
    else bones.push(track);
  }
  const morphs = base.morphs.map((t) => ({ ...t }));
  for (const lt of layer.morphs) {
    if (!lt.keys.length) continue;
    const i = morphs.findIndex((t) => t.name === lt.name);
    const lf = lt.keys[0].f + offset;
    const ll = lt.keys[lt.keys.length - 1].f + offset;
    const bt: MorphTrack = i >= 0 ? morphs[i] : { name: lt.name, keys: [] };
    const keys = bt.keys.filter((k) => k.f < lf || k.f > ll);
    for (let f = lf; f <= ll; f++)
      keys.push({ f, w: (bt.keys.length ? sampleMorph(bt, f) : 0) + sampleMorph(lt, f - offset) * weight });
    const track = { name: lt.name, keys: normalizeKeys(keys) };
    if (i >= 0) morphs[i] = track;
    else morphs.push(track);
  }
  return { ...base, bones, morphs };
}

// ---------------------------------------------------------------- face

/** Standard MMD morph names. */
export const BLINK_MORPH = 'まばたき';
export const VOWELS = ['あ', 'い', 'う', 'え', 'お'] as const;

function addMorphKeys(clip: MotionClip, name: string, keys: MorphKey[]): MotionClip {
  const i = clip.morphs.findIndex((t) => t.name === name);
  const old = i >= 0 ? clip.morphs[i].keys : [];
  const lo = Math.min(...keys.map((k) => k.f));
  const hi = Math.max(...keys.map((k) => k.f));
  const track = { name, keys: normalizeKeys([...old.filter((k) => k.f < lo || k.f > hi), ...keys]) };
  const morphs = [...clip.morphs];
  if (i >= 0) morphs[i] = track;
  else morphs.push(track);
  return { ...clip, morphs };
}

/** One blink starting at `f`: close over 2 frames, hold 1, open over 3. */
export function blink(clip: MotionClip, f: number, morph = BLINK_MORPH): MotionClip {
  return addMorphKeys(clip, morph, [
    { f, w: 0 },
    { f: f + 2, w: 1 },
    { f: f + 3, w: 1 },
    { f: f + 6, w: 0 },
  ]);
}

/** Seeded natural blinking over [from, to]: intervals `interval` ± 40 % frames. */
export function autoBlink(
  clip: MotionClip,
  from: number,
  to: number,
  opts: { interval?: number; seed?: number; morph?: string } = {},
): MotionClip {
  const r = rng(opts.seed ?? 7);
  const interval = opts.interval ?? 90;
  const morph = opts.morph ?? BLINK_MORPH;
  // Clear existing blink keys in range first.
  let out: MotionClip = {
    ...clip,
    morphs: clip.morphs.map((t) =>
      t.name === morph ? { ...t, keys: t.keys.filter((k) => k.f < from || k.f > to) } : t,
    ),
  };
  let f = from + Math.round(interval * (0.3 + r() * 0.5));
  while (f + 6 <= to) {
    out = blink(out, f, morph);
    // Occasional double blink.
    if (r() < 0.15 && f + 14 <= to) out = blink(out, f + 8, morph);
    f += Math.round(interval * (0.6 + r() * 0.8));
  }
  return out;
}

/** A mouth shape: vowel opens to `peak` over 3 frames, holds, closes by `f + length`. */
export function vowel(clip: MotionClip, f: number, v: string, length = 8, peak = 1): MotionClip {
  const close = Math.max(f + 4, f + length);
  return addMorphKeys(clip, v, [
    { f, w: 0 },
    { f: f + 3, w: peak },
    { f: close - 3, w: peak },
    { f: close, w: 0 },
  ]);
}

/** Simple talking pattern over [from, to]: vowels cycled every `every` frames (seeded order). */
export function lipPattern(clip: MotionClip, from: number, to: number, every = 8, seed = 3): MotionClip {
  const r = rng(seed);
  let out = clip;
  for (let f = from; f + every <= to; f += every) {
    out = vowel(out, f, VOWELS[Math.floor(r() * VOWELS.length)], every, 0.5 + r() * 0.5);
  }
  return out;
}
