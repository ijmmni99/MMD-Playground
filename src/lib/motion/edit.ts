// Immutable key operations. Every function returns a new clip; untouched tracks keep their identity.
import { keyIndexAt, upperBound } from './evaluate';
import {
  BONE_CHANNELS,
  CAMERA_CHANNELS,
  CAMERA_TRACK,
  linearCurves,
  type BoneKey,
  type BoneTrack,
  type CameraKey,
  type KeyRef,
  type MorphKey,
  type MotionClip,
} from './types';

const byFrame = <T extends { f: number }>(a: T, b: T): number => a.f - b.f;

/** Insert or replace a key in a sorted key list (returns a new array). */
export function upsertKey<T extends { f: number }>(keys: readonly T[], key: T): T[] {
  const out = keys.slice();
  const i = keyIndexAt(keys, key.f);
  if (i >= 0) out[i] = key;
  else out.splice(upperBound(keys, key.f), 0, key);
  return out;
}

function replaceTrack<T extends { name: string }>(tracks: readonly T[], name: string, next: T | null): T[] {
  const i = tracks.findIndex((t) => t.name === name);
  if (i < 0) return next ? [...tracks, next] : tracks.slice();
  const out = tracks.slice();
  if (next) out[i] = next;
  else out.splice(i, 1);
  return out;
}

export function boneTrack(clip: MotionClip, name: string): BoneTrack | undefined {
  return clip.bones.find((t) => t.name === name);
}

/** Insert/update a bone key. Existing curves are kept unless new ones are given. */
export function setBoneKey(
  clip: MotionClip,
  name: string,
  key: { f: number; p: BoneKey['p']; r: BoneKey['r']; ip?: number[] },
): MotionClip {
  const track = boneTrack(clip, name) ?? { name, keys: [] };
  const existing = track.keys[keyIndexAt(track.keys, key.f)];
  const k: BoneKey = {
    f: key.f,
    p: [...key.p],
    r: [...key.r],
    ip: key.ip ? [...key.ip] : existing ? existing.ip : linearCurves(BONE_CHANNELS),
  };
  if (existing?.phys) k.phys = existing.phys;
  return { ...clip, bones: replaceTrack(clip.bones, name, { name, keys: upsertKey(track.keys, k) }) };
}

export function setMorphKey(clip: MotionClip, name: string, f: number, w: number): MotionClip {
  const track = clip.morphs.find((t) => t.name === name) ?? { name, keys: [] };
  return {
    ...clip,
    morphs: replaceTrack(clip.morphs, name, { name, keys: upsertKey(track.keys, { f, w }) }),
  };
}

export function setCameraKey(clip: MotionClip, key: Omit<CameraKey, 'ip'> & { ip?: number[] }): MotionClip {
  const existing = clip.camera[keyIndexAt(clip.camera, key.f)];
  const k: CameraKey = {
    ...key,
    t: [...key.t],
    r: [...key.r],
    ip: key.ip ? [...key.ip] : existing ? existing.ip : linearCurves(CAMERA_CHANNELS),
  };
  return { ...clip, camera: upsertKey(clip.camera, k) };
}

/** Every key in the clip as refs (optionally limited to a frame range, inclusive). */
export function allKeyRefs(clip: MotionClip, from = -Infinity, to = Infinity): KeyRef[] {
  const out: KeyRef[] = [];
  for (const t of clip.bones)
    for (const k of t.keys) if (k.f >= from && k.f <= to) out.push({ kind: 'bone', track: t.name, f: k.f });
  for (const t of clip.morphs)
    for (const k of t.keys) if (k.f >= from && k.f <= to) out.push({ kind: 'morph', track: t.name, f: k.f });
  for (const k of clip.camera)
    if (k.f >= from && k.f <= to) out.push({ kind: 'camera', track: CAMERA_TRACK, f: k.f });
  return out;
}

/** Group refs by kind + track: Map<"kind\0track", Set<frame>>. */
function groupRefs(refs: readonly KeyRef[]): Map<string, Set<number>> {
  const m = new Map<string, Set<number>>();
  for (const r of refs) {
    const id = `${r.kind}\u0000${r.track}`;
    let s = m.get(id);
    if (!s) m.set(id, (s = new Set()));
    s.add(r.f);
  }
  return m;
}

export function deleteKeys(clip: MotionClip, refs: readonly KeyRef[]): MotionClip {
  if (!refs.length) return clip;
  const groups = groupRefs(refs);
  const drop = <T extends { f: number }>(id: string, keys: T[]): T[] => {
    const s = groups.get(id);
    return s ? keys.filter((k) => !s.has(k.f)) : keys;
  };
  return {
    ...clip,
    bones: clip.bones
      .map((t) =>
        groups.has(`bone\u0000${t.name}`) ? { ...t, keys: drop(`bone\u0000${t.name}`, t.keys) } : t,
      )
      .filter((t) => t.keys.length),
    morphs: clip.morphs
      .map((t) =>
        groups.has(`morph\u0000${t.name}`) ? { ...t, keys: drop(`morph\u0000${t.name}`, t.keys) } : t,
      )
      .filter((t) => t.keys.length),
    camera: groups.has(`camera\u0000${CAMERA_TRACK}`)
      ? drop(`camera\u0000${CAMERA_TRACK}`, clip.camera)
      : clip.camera,
  };
}

/**
 * Move (or copy) keys in time by `delta` frames. Moved keys overwrite keys already at their destination.
 * Returns the new clip and the refs of the moved keys at their new frames.
 */
export function moveKeys(
  clip: MotionClip,
  refs: readonly KeyRef[],
  delta: number,
  opts: { copy?: boolean } = {},
): { clip: MotionClip; refs: KeyRef[] } {
  const d = Math.round(delta);
  if (!refs.length || (d === 0 && !opts.copy)) return { clip, refs: [...refs] };
  const minF = Math.min(...refs.map((r) => r.f));
  const shift = Math.max(d, -minF); // never below frame 0
  const groups = groupRefs(refs);
  const moved: KeyRef[] = [];
  const apply = <T extends { f: number }>(
    id: string,
    keys: T[],
    kind: KeyRef['kind'],
    track: string,
  ): T[] => {
    const s = groups.get(id);
    if (!s) return keys;
    const picked = keys.filter((k) => s.has(k.f)).map((k) => ({ ...k, f: k.f + shift }));
    const dest = new Set(picked.map((k) => k.f));
    const rest = keys.filter((k) => (opts.copy || !s.has(k.f)) && !dest.has(k.f));
    for (const k of picked) moved.push({ kind, track, f: k.f });
    return [...rest, ...picked].sort(byFrame);
  };
  return {
    clip: {
      ...clip,
      bones: clip.bones.map((t) =>
        groups.has(`bone\u0000${t.name}`)
          ? { ...t, keys: apply(`bone\u0000${t.name}`, t.keys, 'bone', t.name) }
          : t,
      ),
      morphs: clip.morphs.map((t) =>
        groups.has(`morph\u0000${t.name}`)
          ? { ...t, keys: apply(`morph\u0000${t.name}`, t.keys, 'morph', t.name) }
          : t,
      ),
      camera: groups.has(`camera\u0000${CAMERA_TRACK}`)
        ? apply(`camera\u0000${CAMERA_TRACK}`, clip.camera, 'camera', CAMERA_TRACK)
        : clip.camera,
    },
    refs: moved,
  };
}

/** Copied keys, frames relative to the earliest one. */
export interface Clipboard {
  bones: { track: string; keys: BoneKey[] }[];
  morphs: { track: string; keys: MorphKey[] }[];
  camera: CameraKey[];
  span: number;
}

export function copyKeys(clip: MotionClip, refs: readonly KeyRef[]): Clipboard | null {
  if (!refs.length) return null;
  const base = Math.min(...refs.map((r) => r.f));
  const groups = groupRefs(refs);
  const pick = <T extends { f: number }>(id: string, keys: T[]): T[] => {
    const s = groups.get(id);
    return s ? keys.filter((k) => s.has(k.f)).map((k) => ({ ...k, f: k.f - base })) : [];
  };
  const bones = clip.bones
    .map((t) => ({ track: t.name, keys: pick(`bone\u0000${t.name}`, t.keys) }))
    .filter((t) => t.keys.length);
  const morphs = clip.morphs
    .map((t) => ({ track: t.name, keys: pick(`morph\u0000${t.name}`, t.keys) }))
    .filter((t) => t.keys.length);
  const camera = pick(`camera\u0000${CAMERA_TRACK}`, clip.camera);
  const span = Math.max(...refs.map((r) => r.f)) - base;
  return { bones, morphs, camera, span };
}

/** Paste a clipboard with its first key at `frame` (+ offset). Returns pasted refs. */
export function pasteKeys(
  clip: MotionClip,
  cb: Clipboard,
  frame: number,
): { clip: MotionClip; refs: KeyRef[] } {
  let out = clip;
  const refs: KeyRef[] = [];
  const at = Math.max(0, Math.round(frame));
  for (const t of cb.bones) {
    for (const k of t.keys) {
      out = setBoneKey(out, t.track, { ...k, f: k.f + at });
      refs.push({ kind: 'bone', track: t.track, f: k.f + at });
    }
  }
  for (const t of cb.morphs) {
    for (const k of t.keys) {
      out = setMorphKey(out, t.track, k.f + at, k.w);
      refs.push({ kind: 'morph', track: t.track, f: k.f + at });
    }
  }
  for (const k of cb.camera) {
    out = setCameraKey(out, { ...k, f: k.f + at });
    refs.push({ kind: 'camera', track: CAMERA_TRACK, f: k.f + at });
  }
  return { clip: out, refs };
}

/** Replace channel curves of the referenced keys (`fn` receives and returns the curve array). */
export function mapCurves(
  clip: MotionClip,
  refs: readonly KeyRef[],
  fn: (ip: number[], kind: KeyRef['kind']) => number[],
): MotionClip {
  const groups = groupRefs(refs);
  const map = <T extends { f: number; ip: number[] }>(id: string, keys: T[], kind: KeyRef['kind']): T[] => {
    const s = groups.get(id);
    return s ? keys.map((k) => (s.has(k.f) ? { ...k, ip: fn(k.ip, kind) } : k)) : keys;
  };
  return {
    ...clip,
    bones: clip.bones.map((t) =>
      groups.has(`bone\u0000${t.name}`) ? { ...t, keys: map(`bone\u0000${t.name}`, t.keys, 'bone') } : t,
    ),
    camera: groups.has(`camera\u0000${CAMERA_TRACK}`)
      ? map(`camera\u0000${CAMERA_TRACK}`, clip.camera, 'camera')
      : clip.camera,
  };
}

/** Remove a whole track. */
export function clearTrack(clip: MotionClip, kind: KeyRef['kind'], name: string): MotionClip {
  if (kind === 'camera') return { ...clip, camera: [] };
  if (kind === 'morph') return { ...clip, morphs: clip.morphs.filter((t) => t.name !== name) };
  return { ...clip, bones: clip.bones.filter((t) => t.name !== name) };
}

// ---------------------------------------------------------------- bone groups (dope sheet rows)

export type BoneGroup = 'center' | 'upper' | 'arms' | 'legs' | 'ik' | 'fingers' | 'other';

export const GROUP_LABEL: Record<BoneGroup | 'morph' | 'camera', string> = {
  center: 'Center',
  upper: 'Upper body',
  arms: 'Arms',
  legs: 'Legs',
  ik: 'IK',
  fingers: 'Fingers',
  other: 'Other bones',
  morph: 'Face / morphs',
  camera: 'Camera',
};

export function boneGroup(name: string): BoneGroup {
  if (/ＩＫ|IK/.test(name)) return 'ik';
  if (/全ての親|センター|グルーブ|腰|下半身/.test(name)) return 'center';
  if (/指/.test(name)) return 'fingers';
  if (/肩|腕|ひじ|手首|手捩|腕捩|手/.test(name)) return 'arms';
  if (/足|ひざ|つま先|下半身/.test(name)) return 'legs';
  if (/上半身|首|頭|目|両目/.test(name)) return 'upper';
  return 'other';
}

export const GROUP_ORDER: (BoneGroup | 'morph' | 'camera')[] = [
  'center',
  'upper',
  'arms',
  'legs',
  'ik',
  'fingers',
  'other',
  'morph',
  'camera',
];
