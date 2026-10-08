// Bake timeline clips into ordinary MotionClips. Each clip's segment is built from its source with the
// Motion Editor's own tools (trim → mirror → retime → loop), so a clip equals the equivalent keyframe
// edits. Joins crossfade per frame (slerp rotations, lerp positions / morphs); camera joins are MMD cuts
// or blends; root continuity offsets the next clip so it starts where the previous one ended.

import { slerp, qnormalize } from '@/lib/math3d';
import { sampleBone, sampleCamera, sampleMorph, upperBound } from '@/lib/motion/evaluate';
import { loop, mirror, retime, trim } from '@/lib/motion/tools';
import {
  BONE_CHANNELS,
  CAMERA_CHANNELS,
  emptyClip,
  linearCurves,
  type BoneKey,
  type CameraKey,
  type MorphKey,
  type MotionClip,
  type PropertyKey,
  type Vec3,
} from '@/lib/motion/types';
import { normalizeName } from '@/lib/names/normalize';
import { clipEnd, clipLength, passLength, type Clip } from './types';

/** Seam blend frames when looping a clip. */
export const LOOP_SEAM = 6;

/**
 * The clip's motion with frames 0…length (the key at `length` is its end pose).
 * `extendOut` adds source frames after the out point (a handle for crossfades; single-pass clips only).
 */
export function segment(source: MotionClip, clip: Clip, extendOut = 0): MotionClip {
  const loops = Math.max(1, clip.loopCount);
  const ext = loops === 1 ? Math.max(0, extendOut) : 0;
  const span = clip.sourceOut - clip.sourceIn;
  let seg = trim(source, clip.sourceIn, clip.sourceOut + ext);
  if (clip.mirror) seg = mirror(seg, { camera: true });
  if (clip.speed !== 1) seg = retime(seg, 0, span + ext, 1 / clip.speed, { camera: true });
  if (loops > 1) {
    const pass = passLength(clip);
    seg = loop(seg, 0, pass, loops, Math.min(LOOP_SEAM, Math.floor(pass / 3)));
  }
  return seg;
}

// ---------------------------------------------------------------- sampling helpers

const smoothstep = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Exact key value on a key frame (the runtime bezier is ~1e-5 off at x = 0), else sampled. */
function boneAt(keys: readonly BoneKey[], f: number): { p: Vec3; r: [number, number, number, number] } {
  const i = upperBound(keys, f) - 1;
  if (i >= 0 && keys[i].f === f) return { p: [...keys[i].p], r: [...keys[i].r] };
  return sampleBone(keys, f);
}

function morphAt(keys: readonly MorphKey[], f: number): number {
  return sampleMorph({ name: '', keys: keys as MorphKey[] }, f);
}

function cameraAt(keys: readonly CameraKey[], f: number) {
  const i = upperBound(keys, f) - 1;
  if (i >= 0 && keys[i].f === f) {
    const k = keys[i];
    return { t: [...k.t] as Vec3, r: [...k.r] as Vec3, d: k.d, fov: k.fov };
  }
  return sampleCamera(keys, f);
}

// ---------------------------------------------------------------- root continuity

const ROOT_ALL = '全ての親';
const CENTER = 'センター';
const LEG_IK = new Set(['左足IK', '右足IK']);

const trackKeys = (clip: MotionClip, name: string): BoneKey[] =>
  clip.bones.find((t) => t.name === name)?.keys ?? [];
const moves = (keys: readonly BoneKey[]): boolean => keys.some((k) => k.p.some((v) => Math.abs(v) > 1e-6));

/** Root position (全ての親 + センター) at a frame. */
function rootPos(clip: MotionClip, f: number): Vec3 {
  const a = boneAt(trackKeys(clip, ROOT_ALL), f).p;
  const c = boneAt(trackKeys(clip, CENTER), f).p;
  return [a[0] + c[0], a[1] + c[1], a[2] + c[2]];
}

/** Offset a clip's root (and leg IK targets when the root is センター) on the floor plane. */
export function offsetRoot(clip: MotionClip, delta: Vec3): MotionClip {
  if (Math.abs(delta[0]) < 1e-9 && Math.abs(delta[2]) < 1e-9) return clip;
  const useAll = moves(trackKeys(clip, ROOT_ALL));
  const targets = new Set(
    useAll
      ? [ROOT_ALL]
      : [CENTER, ...clip.bones.map((t) => t.name).filter((n) => LEG_IK.has(normalizeName(n)))],
  );
  const add = (p: Vec3): Vec3 => [p[0] + delta[0], p[1], p[2] + delta[2]];
  const bones = clip.bones.map((t) =>
    targets.has(t.name) ? { ...t, keys: t.keys.map((k) => ({ ...k, p: add(k.p) })) } : t,
  );
  // A root that isn't keyed at all still needs to move.
  const root = useAll ? ROOT_ALL : CENTER;
  if (!bones.some((t) => t.name === root)) {
    bones.push({
      name: root,
      keys: [{ f: 0, p: add([0, 0, 0]), r: [0, 0, 0, 1], ip: linearCurves(BONE_CHANNELS) }],
    });
  }
  return { ...clip, bones };
}

// ---------------------------------------------------------------- placement

interface Placed {
  clip: Clip;
  start: number;
  end: number;
  seg: MotionClip;
  /** Segment with a handle after the out point (crossfade source); same as `seg` when there is none. */
  ext: MotionClip;
  /** Frames [start, start + fadeIn] blend from the previous clip. */
  fadeIn: number;
}

function place(
  clips: readonly Clip[],
  getSource: (id: string) => MotionClip | undefined,
  kind: 'dance' | 'camera' | 'face',
): Placed[] {
  const sorted = [...clips]
    .filter((c) => c.sourceId && getSource(c.sourceId))
    .sort((a, b) => a.startFrame - b.startFrame);
  const out: Placed[] = [];
  sorted.forEach((c, i) => {
    const src = getSource(c.sourceId!)!;
    const next = sorted[i + 1];
    const handleFrames = next ? Math.max(next.join.fade, clipEnd(c) - next.startFrame, 0) : 0;
    let seg = segment(src, c);
    const hasHandle = handleFrames > 0 && c.loopCount <= 1;
    let ext = hasHandle ? segment(src, c, Math.ceil(handleFrames * c.speed)) : seg;
    const prev = out[out.length - 1];
    if (kind === 'dance' && prev && c.join.root === 'continue') {
      // Start where the previous clip is at this clip's start (its end pose, or its handle when overlapping).
      const want = rootPos(prev.ext, Math.min(c.startFrame, prev.end) - prev.start);
      const have = rootPos(seg, 0);
      const delta: Vec3 = [want[0] - have[0], 0, want[2] - have[2]];
      seg = offsetRoot(seg, delta);
      ext = hasHandle ? offsetRoot(ext, delta) : seg;
    }
    const len = clipLength(c);
    let fadeIn = 0;
    if (prev) {
      const overlap = prev.end - c.startFrame;
      fadeIn = kind === 'camera' && c.join.cut ? 0 : overlap > 0 ? overlap : c.join.fade;
      fadeIn = Math.max(0, Math.min(fadeIn, len));
    }
    out.push({ clip: c, start: c.startFrame, end: c.startFrame + len, seg, ext, fadeIn });
  });
  return out;
}

/** Frame range each placed clip owns outright: [from, to] (inclusive). */
function ownWindow(p: Placed[], i: number): [number, number] {
  const cur = p[i];
  const next = p[i + 1];
  const from = cur.start + cur.fadeIn;
  // When the next clip starts inside this one, it takes over from its start.
  const to = next && next.start < cur.end ? next.start : cur.end;
  return [from, Math.max(from, to)];
}

// ---------------------------------------------------------------- dance

/** Bake a dance (or face) track into one MotionClip. */
export function bakeDance(
  clips: readonly Clip[],
  getSource: (id: string) => MotionClip | undefined,
  kind: 'dance' | 'face' = 'dance',
): MotionClip {
  const placed = place(clips, getSource, kind);
  const out = emptyClip(placed[0] ? getSource(placed[0].clip.sourceId!)!.modelName : '');
  if (!placed.length) return out;

  const boneNames = new Set<string>();
  const morphNames = new Set<string>();
  for (const p of placed) {
    for (const t of p.ext.bones) if (t.keys.length) boneNames.add(t.name);
    for (const t of p.ext.morphs) if (t.keys.length) morphNames.add(t.name);
  }

  for (const name of boneNames) {
    const keys: BoneKey[] = [];
    placed.forEach((p, i) => {
      const own = trackKeys(p.seg, name);
      if (i > 0 && p.fadeIn > 0) {
        const prev = placed[i - 1];
        const prevKeys = trackKeys(prev.ext, name);
        for (let f = p.start; f < p.start + p.fadeIn; f++) {
          const w = smoothstep((f - p.start) / p.fadeIn);
          const a = boneAt(prevKeys, f - prev.start);
          const b = boneAt(own, f - p.start);
          keys.push({
            f,
            p: [0, 1, 2].map((c) => a.p[c] + (b.p[c] - a.p[c]) * w) as Vec3,
            r: qnormalize(slerp(a.r, b.r, w)),
            ip: linearCurves(BONE_CHANNELS),
          });
        }
      }
      const [w0, w1] = ownWindow(placed, i);
      for (const f of [w0, w1]) {
        const s = boneAt(own, f - p.start);
        keys.push({ f, p: s.p, r: s.r, ip: linearCurves(BONE_CHANNELS) });
      }
      for (const k of own) {
        const f = k.f + p.start;
        if (f > w0 && f < w1) keys.push({ ...k, f });
      }
      // Gap before the next clip: hold the end pose.
      const next = placed[i + 1];
      if (next && next.start - 1 > w1) {
        const s = boneAt(own, w1 - p.start);
        keys.push({ f: next.start - 1, p: s.p, r: s.r, ip: linearCurves(BONE_CHANNELS) });
      }
    });
    out.bones.push({ name, keys: dedupe(keys) });
  }

  for (const name of morphNames) {
    const keys: MorphKey[] = [];
    placed.forEach((p, i) => {
      const own = p.seg.morphs.find((t) => t.name === name)?.keys ?? [];
      if (i > 0 && p.fadeIn > 0) {
        const prev = placed[i - 1];
        const prevKeys = prev.ext.morphs.find((t) => t.name === name)?.keys ?? [];
        for (let f = p.start; f < p.start + p.fadeIn; f++) {
          const w = smoothstep((f - p.start) / p.fadeIn);
          keys.push({ f, w: morphAt(prevKeys, f - prev.start) * (1 - w) + morphAt(own, f - p.start) * w });
        }
      }
      const [w0, w1] = ownWindow(placed, i);
      keys.push({ f: w0, w: morphAt(own, w0 - p.start) }, { f: w1, w: morphAt(own, w1 - p.start) });
      for (const k of own)
        if (k.f + p.start > w0 && k.f + p.start < w1) keys.push({ ...k, f: k.f + p.start });
      const next = placed[i + 1];
      if (next && next.start - 1 > w1) keys.push({ f: next.start - 1, w: morphAt(own, w1 - p.start) });
    });
    out.morphs.push({ name, keys: dedupe(keys) });
  }

  // IK on/off and visibility keys: each clip's own window.
  const props: PropertyKey[] = [];
  placed.forEach((p, i) => {
    const w1 = ownWindow(placed, i)[1];
    const from = i === 0 ? p.start : p.start + Math.floor(p.fadeIn / 2);
    const src = p.seg.props;
    if (!src.length) return;
    const at = upperBound(src, from - p.start) - 1;
    props.push({ ...(src[Math.max(0, at)] ?? src[0]), f: from });
    for (const k of src)
      if (k.f + p.start > from && k.f + p.start <= w1) props.push({ ...k, f: k.f + p.start });
  });
  out.props = dedupe(props);
  return out;
}

/** Face clips replace the dance morphs inside their ranges. */
export function applyFace(
  base: MotionClip,
  face: MotionClip,
  ranges: readonly [number, number][],
): MotionClip {
  if (!ranges.length || !face.morphs.length) return base;
  const inside = (f: number): boolean => ranges.some(([a, b]) => f >= a && f <= b);
  const names = new Set([...face.morphs.map((t) => t.name)]);
  const morphs = base.morphs.filter((t) => !names.has(t.name));
  for (const name of names) {
    const baseKeys = base.morphs.find((t) => t.name === name)?.keys ?? [];
    const faceKeys = face.morphs.find((t) => t.name === name)?.keys ?? [];
    const keys: MorphKey[] = baseKeys.filter((k) => !inside(k.f));
    for (const [a, b] of ranges) {
      if (baseKeys.length && a > 0) keys.push({ f: a - 1, w: morphAt(baseKeys, a - 1) });
      keys.push({ f: a, w: morphAt(faceKeys, a) }, { f: b, w: morphAt(faceKeys, b) });
      for (const k of faceKeys) if (k.f > a && k.f < b) keys.push(k);
      if (baseKeys.length) keys.push({ f: b + 1, w: morphAt(baseKeys, b + 1) });
    }
    morphs.push({ name, keys: dedupe(keys) });
  }
  return { ...base, morphs };
}

// ---------------------------------------------------------------- camera

/** Bake a camera track: hard cuts as MMD cut pairs, blends over `fade` frames. */
export function bakeCamera(
  clips: readonly Clip[],
  getSource: (id: string) => MotionClip | undefined,
): MotionClip {
  const placed = place(clips, getSource, 'camera');
  const out = emptyClip('カメラ・照明');
  if (!placed.length) return out;
  const keys: CameraKey[] = [];
  const key = (f: number, v: ReturnType<typeof cameraAt>, ip?: number[]): CameraKey => ({
    f,
    t: v.t,
    r: v.r,
    d: v.d,
    fov: Math.max(1, Math.min(125, Math.round(v.fov))),
    persp: true,
    ip: ip ?? linearCurves(CAMERA_CHANNELS),
  });
  placed.forEach((p, i) => {
    const own = p.seg.camera;
    const [w0, w1] = ownWindow(placed, i);
    if (i > 0) {
      const prev = placed[i - 1];
      if (p.fadeIn > 0) {
        // Blend keys every 2 frames so they never form accidental cut pairs.
        for (let f = p.start; f <= w0 - 2; f += 2) {
          const w = smoothstep((f - p.start) / p.fadeIn);
          const a = cameraAt(prev.ext.camera, f - prev.start);
          const b = cameraAt(own, f - p.start);
          const l = (x: number, y: number): number => x + (y - x) * w;
          keys.push(
            key(f, {
              t: [l(a.t[0], b.t[0]), l(a.t[1], b.t[1]), l(a.t[2], b.t[2])],
              r: [l(a.r[0], b.r[0]), l(a.r[1], b.r[1]), l(a.r[2], b.r[2])],
              d: l(a.d, b.d),
              fov: l(a.fov, b.fov),
            }),
          );
        }
      } else {
        // Hard cut: the previous shot holds until the frame before (consecutive keys = MMD cut).
        keys.push(key(p.start - 1, cameraAt(prev.ext.camera, p.start - 1 - prev.start)));
      }
    }
    keys.push(key(w0, cameraAt(own, w0 - p.start)));
    for (const k of own) if (k.f + p.start > w0 && k.f + p.start < w1) keys.push({ ...k, f: k.f + p.start });
    keys.push(key(w1, cameraAt(own, w1 - p.start)));
  });
  out.camera = dedupe(keys);
  return out;
}

/** Sort by frame; the last key for a frame wins. */
function dedupe<T extends { f: number }>(keys: T[]): T[] {
  const m = new Map<number, T>();
  for (const k of keys) if (k.f >= 0) m.set(k.f, k);
  return [...m.values()].sort((a, b) => a.f - b.f);
}
