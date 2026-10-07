import Encoding from 'encoding-japanese';

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

export interface VmdInput {
  modelName: string;
  bones: BoneKey[];
  properties?: PropertyKey[];
}

export const VMD_SIGNATURE = 'Vocaloid Motion Data 0002';
export const VMD_HEADER_BYTES = 30;
export const VMD_MODEL_NAME_BYTES = 20;
export const VMD_BONE_NAME_BYTES = 15;
export const VMD_BONE_KEY_BYTES = 111;
const IK_NAME_BYTES = 20;

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
export function shiftJis(text: string, max: number): Uint8Array {
  const codes = Encoding.convert(Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' });
  let end = 0;
  for (let i = 0; i < codes.length;) {
    const lead = codes[i];
    const width = (lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xfc) ? 2 : 1;
    if (i + width > max) break;
    i += width;
    end = i;
  }
  return Uint8Array.from(codes.slice(0, end));
}

function writeFixed(bytes: Uint8Array, offset: number, value: Uint8Array, size: number): void {
  bytes.fill(0, offset, offset + size);
  bytes.set(value.subarray(0, size), offset);
}

/** Sort by bone name then frame and drop duplicate frames per bone (the last one wins). */
export function normalizeBoneKeys(keys: BoneKey[]): BoneKey[] {
  const byKey = new Map<string, BoneKey>();
  for (const k of keys) byKey.set(`${k.bone}\u0000${Math.round(k.frame)}`, k);
  return [...byKey.values()]
    .map((k) => ({ ...k, frame: Math.max(0, Math.round(k.frame)) }))
    .sort((a, b) => (a.bone < b.bone ? -1 : a.bone > b.bone ? 1 : a.frame - b.frame));
}

/** Serialise a bone motion to the binary VMD format (little-endian, Shift-JIS names). */
export function writeVmd(input: VmdInput): ArrayBuffer {
  const bones = normalizeBoneKeys(input.bones);
  const properties = [...(input.properties ?? [])].sort((a, b) => a.frame - b.frame);
  const propertyBytes = properties.reduce((n, p) => n + 4 + 1 + 4 + p.ik.length * (IK_NAME_BYTES + 1), 0);
  const size =
    VMD_HEADER_BYTES +
    VMD_MODEL_NAME_BYTES +
    4 +
    bones.length * VMD_BONE_KEY_BYTES +
    4 + // morphs
    4 + // camera
    4 + // light
    4 + // self shadow
    4 +
    propertyBytes;
  const buffer = new ArrayBuffer(size);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  for (let i = 0; i < VMD_SIGNATURE.length; i++) bytes[i] = VMD_SIGNATURE.charCodeAt(i);
  let o = VMD_HEADER_BYTES;
  writeFixed(bytes, o, shiftJis(input.modelName, VMD_MODEL_NAME_BYTES), VMD_MODEL_NAME_BYTES);
  o += VMD_MODEL_NAME_BYTES;

  view.setUint32(o, bones.length, true);
  o += 4;
  const names = new Map<string, Uint8Array>();
  for (const k of bones) {
    let name = names.get(k.bone);
    if (!name) names.set(k.bone, (name = shiftJis(k.bone, VMD_BONE_NAME_BYTES)));
    writeFixed(bytes, o, name, VMD_BONE_NAME_BYTES);
    view.setUint32(o + 15, k.frame, true);
    for (let i = 0; i < 3; i++) view.setFloat32(o + 19 + i * 4, k.position[i], true);
    for (let i = 0; i < 4; i++) view.setFloat32(o + 31 + i * 4, k.rotation[i], true);
    bytes.set(LINEAR_INTERPOLATION, o + 47);
    o += VMD_BONE_KEY_BYTES;
  }

  // Morph, camera, light and self-shadow sections are empty.
  for (let i = 0; i < 4; i++) {
    view.setUint32(o, 0, true);
    o += 4;
  }

  view.setUint32(o, properties.length, true);
  o += 4;
  for (const p of properties) {
    view.setUint32(o, Math.max(0, Math.round(p.frame)), true);
    bytes[o + 4] = p.visible ? 1 : 0;
    view.setUint32(o + 5, p.ik.length, true);
    o += 9;
    for (const ik of p.ik) {
      writeFixed(bytes, o, shiftJis(ik.bone, IK_NAME_BYTES), IK_NAME_BYTES);
      bytes[o + IK_NAME_BYTES] = ik.enabled ? 1 : 0;
      o += IK_NAME_BYTES + 1;
    }
  }
  return buffer;
}
