import Encoding from 'encoding-japanese';
import type { PoseData } from '@/engine/types';

/** Parse and write MikuMikuDance pose files (.vpd, Shift-JIS text). Coordinates are MMD's, like VMD. */

export interface VpdBone {
  name: string;
  position: [number, number, number];
  /** Quaternion x, y, z, w. */
  rotation: [number, number, number, number];
}

export interface Vpd {
  /** Model file name written in the header (informational). */
  modelName: string;
  bones: VpdBone[];
  morphs: Record<string, number>;
}

function decode(bytes: Uint8Array): string {
  return Encoding.convert(Array.from(bytes), { to: 'UNICODE', from: 'SJIS', type: 'string' });
}

const NUM = '(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)';
const BONE_RE = new RegExp(
  `Bone\\d+\\s*\\{([^\\r\\n]*)\\s+${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*;[^\\r\\n]*\\s+${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*;[^\\r\\n]*\\s*\\}`,
  'g',
);
const MORPH_RE = new RegExp(`Morph\\d+\\s*\\{([^\\r\\n]*)\\s+${NUM}\\s*;[^\\r\\n]*\\s*\\}`, 'g');

/** Parse a VPD. Throws when the signature is missing. Entries that don't parse are skipped. */
export function parseVpd(buffer: ArrayBuffer): Vpd {
  const text = decode(new Uint8Array(buffer)).replace(new RegExp('^\\uFEFF'), '');
  if (!/^\s*Vocaloid Pose Data file/.test(text)) throw new Error('Not a VPD file');
  const header = /^[ \t]*([^\r\n;]*?)[ \t]*;/m.exec(text.replace(/^\s*Vocaloid Pose Data file[^\r\n]*/, ''));
  const vpd: Vpd = { modelName: header?.[1] ?? '', bones: [], morphs: {} };
  for (const m of text.matchAll(BONE_RE)) {
    const n = m.slice(2).map(Number);
    if (n.some((v) => !Number.isFinite(v))) continue;
    vpd.bones.push({
      name: m[1].trim(),
      position: [n[0], n[1], n[2]],
      rotation: [n[3], n[4], n[5], n[6]],
    });
  }
  for (const m of text.matchAll(MORPH_RE)) {
    const v = Number(m[2]);
    if (Number.isFinite(v)) vpd.morphs[m[1].trim()] = v;
  }
  return vpd;
}

const f6 = (n: number): string => (Number.isFinite(n) ? n : 0).toFixed(6);

/** Serialise to Shift-JIS VPD bytes. Characters Shift-JIS can't hold are replaced. */
export function writeVpd(vpd: Vpd): Uint8Array {
  const morphs = Object.entries(vpd.morphs);
  const lines = [
    'Vocaloid Pose Data file',
    '',
    `${vpd.modelName};\t\t// parent file`,
    `${vpd.bones.length};\t\t// total pose count`,
    '',
  ];
  vpd.bones.forEach((b, i) => {
    lines.push(
      `Bone${i}{${b.name}`,
      `  ${b.position.map(f6).join(',')};\t\t// trans x,y,z`,
      `  ${b.rotation.map(f6).join(',')};\t\t// Quaternion x,y,z,w`,
      '}',
      '',
    );
  });
  morphs.forEach(([name, w], i) => {
    lines.push(`Morph${i}{${name}`, `  ${f6(w)};`, '}', '');
  });
  const text = lines.join('\r\n');
  const codes = Encoding.convert(Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' });
  return Uint8Array.from(codes);
}

/** MMD Studio pose from a VPD. Same coordinate system, so values pass through unchanged. */
export function vpdToPose(vpd: Vpd): PoseData {
  return {
    version: 1,
    model: vpd.modelName,
    bones: vpd.bones.map((b) => ({ name: b.name, rotation: b.rotation, position: b.position })),
    morphs: { ...vpd.morphs },
  };
}

/** VPD for an MMD Studio pose. Bones at rest are left out. */
export function poseToVpd(pose: PoseData): Vpd {
  const atRest = (b: PoseData['bones'][number]): boolean =>
    b.position.every((v) => Math.abs(v) < 1e-6) &&
    Math.abs(b.rotation[0]) < 1e-6 &&
    Math.abs(b.rotation[1]) < 1e-6 &&
    Math.abs(b.rotation[2]) < 1e-6 &&
    Math.abs(b.rotation[3] - 1) < 1e-6;
  return {
    modelName: pose.model,
    bones: pose.bones
      .filter((b) => !atRest(b))
      .map((b) => ({ name: b.name, position: b.position, rotation: b.rotation })),
    morphs: Object.fromEntries(Object.entries(pose.morphs).filter(([, v]) => v !== 0)),
  };
}
