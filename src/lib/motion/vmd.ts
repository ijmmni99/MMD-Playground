import { decodeSjis, encodeSjis } from './sjis';
import {
  BONE_CHANNELS,
  CAMERA_CHANNELS,
  type BoneKey,
  type BoneTrack,
  type CameraKey,
  type LightKey,
  type MorphTrack,
  type MotionClip,
  type PropertyKey,
  type ShadowKey,
  type Vec3,
} from './types';

export const VMD_SIGNATURE = 'Vocaloid Motion Data 0002';
const OLD_SIGNATURE = 'Vocaloid Motion Data file';
export const RECORD = { bone: 111, morph: 23, camera: 61, light: 28, shadow: 9 } as const;
const BONE_NAME = 15;
const IK_NAME = 20;
/** Physics toggle value meaning "physics off" in bytes 2–3 of a bone interpolation block. */
export const PHYSICS_OFF = 0x630f;

// ---------------------------------------------------------------- reading

class Reader {
  o = 0;
  readonly view: DataView;
  readonly bytes: Uint8Array;
  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
  }
  left(): number {
    return this.bytes.length - this.o;
  }
  u8(): number {
    return this.view.getUint8(this.o++);
  }
  u32(): number {
    const v = this.view.getUint32(this.o, true);
    this.o += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.o, true);
    this.o += 4;
    return v;
  }
  vec3(): Vec3 {
    return [this.f32(), this.f32(), this.f32()];
  }
  text(n: number): string {
    const s = decodeSjis(this.bytes.subarray(this.o, this.o + n));
    this.o += n;
    return s;
  }
  raw(n: number): Uint8Array {
    const b = this.bytes.subarray(this.o, this.o + n);
    this.o += n;
    return b;
  }
  /** Section count, or 0 when the file ends early (older writers omit trailing sections). */
  count(record: number): number {
    if (this.left() < 4) return 0;
    const n = this.u32();
    return record > 0 ? Math.min(n, Math.floor(this.left() / record)) : n;
  }
}

/** Read the 64-byte bone interpolation block: channel c from row c at offsets 0/4/8/12 (as MMD/babylon-mmd). */
function readBoneCurves(b: Uint8Array): { ip: number[]; phys: number } {
  const ip: number[] = [];
  for (let c = 0; c < BONE_CHANNELS; c++) {
    const row = c * 16;
    ip.push(b[row], b[row + 4], b[row + 8], b[row + 12]);
  }
  return { ip, phys: (b[2] << 8) | b[3] };
}

/** Camera interpolation: 24 bytes, x1, x2, y1, y2 per channel. */
function readCameraCurves(b: Uint8Array): number[] {
  const ip: number[] = [];
  for (let c = 0; c < CAMERA_CHANNELS; c++) ip.push(b[c * 4], b[c * 4 + 2], b[c * 4 + 1], b[c * 4 + 3]);
  return ip;
}

/** Parse any VMD into an editable clip. Duplicate frames per track keep the last record (like the loader). */
export function readVmd(buffer: ArrayBuffer): MotionClip {
  const r = new Reader(buffer);
  const sig = new TextDecoder('ascii').decode(r.raw(30)).replace(/\0.*$/s, '');
  const old = sig.startsWith(OLD_SIGNATURE);
  if (!sig.startsWith(VMD_SIGNATURE) && !old) throw new Error('Not a VMD file');
  const modelName = r.text(old ? 10 : 20);

  const bones = new Map<string, Map<number, BoneKey>>();
  const boneOrder: string[] = [];
  const nBones = r.count(RECORD.bone);
  for (let i = 0; i < nBones; i++) {
    const name = r.text(BONE_NAME);
    const f = r.u32();
    const p = r.vec3();
    const q: [number, number, number, number] = [r.f32(), r.f32(), r.f32(), r.f32()];
    const { ip, phys } = readBoneCurves(r.raw(64));
    let track = bones.get(name);
    if (!track) {
      bones.set(name, (track = new Map()));
      boneOrder.push(name);
    }
    const key: BoneKey = { f, p, r: q, ip };
    if (phys) key.phys = phys;
    track.set(f, key);
  }

  const morphs = new Map<string, Map<number, number>>();
  const morphOrder: string[] = [];
  const nMorphs = r.count(RECORD.morph);
  for (let i = 0; i < nMorphs; i++) {
    const name = r.text(BONE_NAME);
    const f = r.u32();
    const w = r.f32();
    let track = morphs.get(name);
    if (!track) {
      morphs.set(name, (track = new Map()));
      morphOrder.push(name);
    }
    track.set(f, w);
  }

  const camera = new Map<number, CameraKey>();
  const nCam = r.count(RECORD.camera);
  for (let i = 0; i < nCam; i++) {
    const f = r.u32();
    const d = r.f32();
    const t = r.vec3();
    const rot = r.vec3();
    const ip = readCameraCurves(r.raw(24));
    const fov = r.u32();
    const persp = r.u8() === 0; // VMD stores 0 = perspective on
    camera.set(f, { f, t, r: rot, d, fov, persp, ip });
  }

  const lights: LightKey[] = [];
  const nLights = r.count(RECORD.light);
  for (let i = 0; i < nLights; i++) lights.push({ f: r.u32(), color: r.vec3(), dir: r.vec3() });

  const shadows: ShadowKey[] = [];
  const nShadows = r.count(RECORD.shadow);
  for (let i = 0; i < nShadows; i++) shadows.push({ f: r.u32(), mode: r.u8(), dist: r.f32() });

  const props = new Map<number, PropertyKey>();
  const nProps = r.count(0);
  for (let i = 0; i < nProps && r.left() >= 9; i++) {
    const f = r.u32();
    const visible = r.u8() !== 0;
    const n = r.u32();
    const ik: Record<string, boolean> = {};
    for (let j = 0; j < n && r.left() >= IK_NAME + 1; j++) ik[r.text(IK_NAME)] = r.u8() !== 0;
    props.set(f, { f, visible, ik });
  }

  const sortKeys = <T extends { f: number }>(m: Map<number, T>): T[] =>
    [...m.values()].sort((a, b) => a.f - b.f);
  return {
    modelName,
    bones: boneOrder.map((name): BoneTrack => ({ name, keys: sortKeys(bones.get(name)!) })),
    morphs: morphOrder.map((name): MorphTrack => ({
      name,
      keys: [...morphs.get(name)!.entries()].map(([f, w]) => ({ f, w })).sort((a, b) => a.f - b.f),
    })),
    props: sortKeys(props),
    camera: sortKeys(camera),
    lights,
    shadows,
  };
}

// ---------------------------------------------------------------- writing

/** Which sections to write. */
export interface WriteOptions {
  bones?: boolean | ((name: string) => boolean);
  morphs?: boolean | ((name: string) => boolean);
  camera?: boolean;
  lights?: boolean;
  shadows?: boolean;
  props?: boolean;
}

const include = (opt: boolean | ((n: string) => boolean) | undefined, name: string): boolean =>
  opt === undefined ? true : typeof opt === 'function' ? opt(name) : opt;

/** 64-byte block: S = [X x1,Y x1,Z x1,R x1, X y1..R y1, X x2..R x2, X y2..R y2]; row r = S shifted by r. */
export function boneInterpolationBlock(ip: ArrayLike<number>, phys = 0): Uint8Array {
  const s: number[] = [];
  for (const k of [0, 1, 2, 3]) for (let c = 0; c < BONE_CHANNELS; c++) s.push(ip[c * 4 + k]);
  const out = new Uint8Array(64);
  for (let row = 0; row < 4; row++) for (let i = 0; i < 16; i++) out[row * 16 + i] = s[i + row] ?? 0;
  out[2] = (phys >> 8) & 0xff;
  out[3] = phys & 0xff;
  return out;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Serialise a clip to VMD (little-endian, Shift-JIS names). Bones/morphs sorted by name then frame. */
export function writeVmd(clip: MotionClip, opts: WriteOptions = {}): ArrayBuffer {
  const bones = clip.bones
    .filter((t) => include(opts.bones, t.name) && t.keys.length)
    .sort((a, b) => cmp(a.name, b.name));
  const morphs = clip.morphs
    .filter((t) => include(opts.morphs, t.name) && t.keys.length)
    .sort((a, b) => cmp(a.name, b.name));
  const camera = opts.camera === false ? [] : [...clip.camera].sort((a, b) => a.f - b.f);
  const lights = opts.lights === false ? [] : clip.lights;
  const shadows = opts.shadows === false ? [] : clip.shadows;
  const props = opts.props === false ? [] : [...clip.props].sort((a, b) => a.f - b.f);
  const boneCount = bones.reduce((n, t) => n + t.keys.length, 0);
  const morphCount = morphs.reduce((n, t) => n + t.keys.length, 0);
  const propBytes = props.reduce((n, p) => n + 9 + Object.keys(p.ik).length * (IK_NAME + 1), 0);
  const size =
    30 +
    20 +
    4 +
    boneCount * RECORD.bone +
    4 +
    morphCount * RECORD.morph +
    4 +
    camera.length * RECORD.camera +
    4 +
    lights.length * RECORD.light +
    4 +
    shadows.length * RECORD.shadow +
    4 +
    propBytes;
  const buffer = new ArrayBuffer(size);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  for (let i = 0; i < VMD_SIGNATURE.length; i++) bytes[i] = VMD_SIGNATURE.charCodeAt(i);
  let o = 30;
  const fixed = (text: string, n: number): void => {
    bytes.set(encodeSjis(text, n), o);
    o += n;
  };
  const u32 = (v: number): void => {
    view.setUint32(o, Math.max(0, Math.round(v)) >>> 0, true);
    o += 4;
  };
  const f32 = (v: number): void => {
    view.setFloat32(o, v, true);
    o += 4;
  };
  fixed(clip.modelName, 20);

  u32(boneCount);
  for (const t of bones) {
    const name = encodeSjis(t.name, BONE_NAME);
    for (const k of t.keys) {
      bytes.set(name, o);
      o += BONE_NAME;
      u32(k.f);
      for (const v of k.p) f32(v);
      for (const v of k.r) f32(v);
      bytes.set(boneInterpolationBlock(k.ip, k.phys ?? 0), o);
      o += 64;
    }
  }

  u32(morphCount);
  for (const t of morphs) {
    const name = encodeSjis(t.name, BONE_NAME);
    for (const k of t.keys) {
      bytes.set(name, o);
      o += BONE_NAME;
      u32(k.f);
      f32(k.w);
    }
  }

  u32(camera.length);
  for (const k of camera) {
    u32(k.f);
    f32(k.d);
    for (const v of k.t) f32(v);
    for (const v of k.r) f32(v);
    for (let c = 0; c < CAMERA_CHANNELS; c++) {
      bytes[o++] = k.ip[c * 4];
      bytes[o++] = k.ip[c * 4 + 2];
      bytes[o++] = k.ip[c * 4 + 1];
      bytes[o++] = k.ip[c * 4 + 3];
    }
    u32(k.fov);
    bytes[o++] = k.persp ? 0 : 1;
  }

  u32(lights.length);
  for (const k of lights) {
    u32(k.f);
    for (const v of k.color) f32(v);
    for (const v of k.dir) f32(v);
  }

  u32(shadows.length);
  for (const k of shadows) {
    u32(k.f);
    bytes[o++] = k.mode;
    f32(k.dist);
  }

  u32(props.length);
  for (const p of props) {
    u32(p.f);
    bytes[o++] = p.visible ? 1 : 0;
    const entries = Object.entries(p.ik);
    u32(entries.length);
    for (const [name, on] of entries) {
      bytes.set(encodeSjis(name, IK_NAME), o);
      o += IK_NAME;
      bytes[o++] = on ? 1 : 0;
    }
  }
  return buffer;
}
