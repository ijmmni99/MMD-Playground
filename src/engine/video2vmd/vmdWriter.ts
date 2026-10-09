import { encodeSjis } from '@/lib/motion/sjis';
import {
  BONE_CHANNELS,
  emptyClip,
  linearCurves,
  type BoneTrack,
  type MorphTrack,
  type MotionClip,
} from '@/lib/motion/types';
import { writeVmd as writeMotion } from '@/lib/motion/vmd';

/** One bone keyframe. Position is the offset from the rest position; rotation is the local quaternion. */
export interface BoneKey {
  bone: string;
  frame: number;
  position: [number, number, number];
  /** Quaternion x, y, z, w. */
  rotation: [number, number, number, number];
}

/** IK on/off state (VMD "property" / display keyframe). */
export interface PropertyKey {
  frame: number;
  visible: boolean;
  ik: { bone: string; enabled: boolean }[];
}

/** One morph (face) keyframe. */
export interface MorphKey {
  morph: string;
  frame: number;
  /** 0–1. */
  weight: number;
}

export interface VmdInput {
  modelName: string;
  bones: BoneKey[];
  morphs?: MorphKey[];
  properties?: PropertyKey[];
}

export const VMD_SIGNATURE = 'Vocaloid Motion Data 0002';
export const VMD_HEADER_BYTES = 30;
export const VMD_MODEL_NAME_BYTES = 20;
export const VMD_BONE_NAME_BYTES = 15;
export const VMD_BONE_KEY_BYTES = 111;
/** 15-byte Shift-JIS name + uint32 frame + float32 weight. */
export const VMD_MORPH_KEY_BYTES = 23;

/**
 * Standard linear interpolation block written by MMD: control points (20,20)-(107,107) for X, Y, Z and
 * rotation. The 64 bytes are four 16-byte rows; each row is the previous one shifted left by one byte.
 * Bytes 2–3 of the first row double as the physics toggle; 0,0 means "physics on" (MMD's default).
 */
export const LINEAR_INTERPOLATION: Uint8Array = (() => {
  const row = [20, 20, 20, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107];
  const out = new Uint8Array(64);
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < 16; i++) out[r * 16 + i] = row[i + r] ?? 0;
  }
  out[2] = 0;
  out[3] = 0;
  return out;
})();

/** Shift-JIS bytes for `text`, cut to at most `max` bytes without splitting a double-byte character. */
export const shiftJis = encodeSjis;

/** Sort by bone name then frame and drop duplicate frames per bone (the last one wins). */
export function normalizeBoneKeys(keys: BoneKey[]): BoneKey[] {
  const byKey = new Map<string, BoneKey>();
  for (const k of keys) byKey.set(`${k.bone}\u0000${Math.round(k.frame)}`, k);
  return [...byKey.values()]
    .map((k) => ({ ...k, frame: Math.max(0, Math.round(k.frame)) }))
    .sort((a, b) => (a.bone < b.bone ? -1 : a.bone > b.bone ? 1 : a.frame - b.frame));
}

/** Sort by morph name then frame and drop duplicate frames per morph (the last one wins). */
export function normalizeMorphKeys(keys: MorphKey[]): MorphKey[] {
  const byKey = new Map<string, MorphKey>();
  for (const k of keys) byKey.set(`${k.morph}\u0000${Math.round(k.frame)}`, k);
  return [...byKey.values()]
    .map((k) => ({ ...k, frame: Math.max(0, Math.round(k.frame)) }))
    .sort((a, b) => (a.morph < b.morph ? -1 : a.morph > b.morph ? 1 : a.frame - b.frame));
}

/** Serialise a bone (+ morph) motion to the binary VMD format (delegates to the shared motion-library writer). */
export function writeVmd(input: VmdInput): ArrayBuffer {
  const tracks = new Map<string, BoneTrack>();
  for (const k of normalizeBoneKeys(input.bones)) {
    let t = tracks.get(k.bone);
    if (!t) tracks.set(k.bone, (t = { name: k.bone, keys: [] }));
    t.keys.push({ f: k.frame, p: [...k.position], r: [...k.rotation], ip: linearCurves(BONE_CHANNELS) });
  }
  const morphs = new Map<string, MorphTrack>();
  for (const k of normalizeMorphKeys(input.morphs ?? [])) {
    let t = morphs.get(k.morph);
    if (!t) morphs.set(k.morph, (t = { name: k.morph, keys: [] }));
    t.keys.push({ f: k.frame, w: k.weight });
  }
  const clip: MotionClip = {
    ...emptyClip(input.modelName),
    bones: [...tracks.values()],
    morphs: [...morphs.values()],
    props: (input.properties ?? []).map((p) => ({
      f: Math.max(0, Math.round(p.frame)),
      visible: p.visible,
      ik: Object.fromEntries(p.ik.map((i) => [i.bone, i.enabled])),
    })),
  };
  return writeMotion(clip);
}
