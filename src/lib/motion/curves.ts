// Graph-editor channel model: which value curves a track shows, how to sample them and how to write a
// key's value back. Rotations are shown as Euler angles (degrees, babylon's YXZ yaw-pitch-roll order)
// unwrapped for continuity; the stored data stays quaternions.

import { qdot, qneg, qnormalize } from '@/lib/math3d';
import { clampByte } from './bezier';
import { keyIndexAt, sampleBone, sampleCamera, sampleMorph } from './evaluate';
import { CAMERA_TRACK, type KeyRef, type MotionClip, type Quat, type Vec3 } from './types';

const DEG = 180 / Math.PI;

/** Quaternion → Euler (x = pitch, y = yaw, z = roll; radians), identical to babylon's `toEulerAngles`. */
export function quatToEuler(q: Quat): Vec3 {
  const [qx, qy, qz, qw] = q;
  const zAxisY = qy * qz - qx * qw;
  const limit = 0.4999999;
  if (zAxisY < -limit) return [Math.PI / 2, 2 * Math.atan2(qy, qw), 0];
  if (zAxisY > limit) return [-Math.PI / 2, 2 * Math.atan2(qy, qw), 0];
  const sqw = qw * qw;
  const sqz = qz * qz;
  const sqx = qx * qx;
  const sqy = qy * qy;
  return [
    Math.asin(-2 * zAxisY),
    Math.atan2(2 * (qz * qx + qy * qw), sqz - sqx - sqy + sqw),
    Math.atan2(2 * (qx * qy + qz * qw), -sqz - sqx + sqy + sqw),
  ];
}

/** Euler (x = pitch, y = yaw, z = roll; radians) → quaternion, identical to babylon's `RotationYawPitchRoll`. */
export function eulerToQuat(e: Vec3): Quat {
  const hp = e[0] / 2;
  const hy = e[1] / 2;
  const hr = e[2] / 2;
  const sp = Math.sin(hp);
  const cp = Math.cos(hp);
  const sy = Math.sin(hy);
  const cy = Math.cos(hy);
  const sr = Math.sin(hr);
  const cr = Math.cos(hr);
  return [
    cy * sp * cr + sy * cp * sr,
    sy * cp * cr - cy * sp * sr,
    cy * cp * sr - sy * sp * cr,
    cy * cp * cr + sy * sp * sr,
  ];
}

/** Shift an angle by whole turns to land closest to `ref` (continuity for display). */
export function unwrapNear(a: number, ref: number, period = 2 * Math.PI): number {
  return a + Math.round((ref - a) / period) * period;
}

/** Make consecutive quaternions share a hemisphere (q and -q are the same rotation). */
export function quatContinuity(qs: readonly Quat[]): Quat[] {
  const out: Quat[] = [];
  for (const q of qs) {
    const prev = out[out.length - 1];
    out.push(prev && qdot(prev, q) < 0 ? qneg(q) : [...q]);
  }
  return out;
}

export interface ChannelDef {
  id: string;
  label: string;
  color: string;
  /** Interpolation curve (bezier channel) that drives this value. -1 = linear (morphs). */
  curve: number;
  /** Display unit factor (radians → degrees). */
  unit: number;
  /** Rotation component (unwrapped for display). */
  angle?: boolean;
}

const C = {
  x: '#ef5350',
  y: '#66bb6a',
  z: '#42a5f5',
  r: '#ffca28',
  d: '#ab47bc',
  f: '#26c6da',
  w: '#f06292',
};

export function channelDefs(kind: KeyRef['kind']): ChannelDef[] {
  if (kind === 'morph') return [{ id: 'w', label: 'Weight', color: C.w, curve: -1, unit: 1 }];
  if (kind === 'camera')
    return [
      { id: 'tx', label: 'Target X', color: C.x, curve: 0, unit: 1 },
      { id: 'ty', label: 'Target Y', color: C.y, curve: 1, unit: 1 },
      { id: 'tz', label: 'Target Z', color: C.z, curve: 2, unit: 1 },
      { id: 'rx', label: 'Rot X°', color: '#ff8a80', curve: 3, unit: DEG, angle: true },
      { id: 'ry', label: 'Rot Y°', color: '#b9f6ca', curve: 3, unit: DEG, angle: true },
      { id: 'rz', label: 'Rot Z°', color: '#82b1ff', curve: 3, unit: DEG, angle: true },
      { id: 'd', label: 'Distance', color: C.d, curve: 4, unit: 1 },
      { id: 'fov', label: 'FOV°', color: C.f, curve: 5, unit: 1 },
    ];
  return [
    { id: 'px', label: 'Pos X', color: C.x, curve: 0, unit: 1 },
    { id: 'py', label: 'Pos Y', color: C.y, curve: 1, unit: 1 },
    { id: 'pz', label: 'Pos Z', color: C.z, curve: 2, unit: 1 },
    { id: 'rx', label: 'Rot X°', color: '#ff8a80', curve: 3, unit: DEG, angle: true },
    { id: 'ry', label: 'Rot Y°', color: '#b9f6ca', curve: 3, unit: DEG, angle: true },
    { id: 'rz', label: 'Rot Z°', color: '#82b1ff', curve: 3, unit: DEG, angle: true },
  ];
}

/** Raw (radian / unit-less) values of every channel of a track at a frame. */
function rawAt(clip: MotionClip, kind: KeyRef['kind'], track: string, f: number): number[] {
  if (kind === 'morph') {
    const t = clip.morphs.find((m) => m.name === track);
    return [t ? sampleMorph(t, f) : 0];
  }
  if (kind === 'camera') {
    const c = sampleCamera(clip.camera, f);
    return [...c.t, ...c.r, c.d, c.fov];
  }
  const t = clip.bones.find((b) => b.name === track);
  const s = sampleBone(t?.keys ?? [], f);
  return [...s.p, ...quatToEuler(s.r)];
}

export interface ChannelSeries {
  frames: number[];
  /** values[channel][i], display units, angles unwrapped along the series. */
  values: number[][];
}

/** Sample all channels at the given (sorted) frames, display units, angles continuous. */
export function sampleChannels(
  clip: MotionClip,
  kind: KeyRef['kind'],
  track: string,
  frames: readonly number[],
): ChannelSeries {
  const defs = channelDefs(kind);
  const values = defs.map(() => [] as number[]);
  for (let i = 0; i < frames.length; i++) {
    const raw = rawAt(clip, kind, track, frames[i]);
    for (let c = 0; c < defs.length; c++) {
      let v = raw[c];
      if (defs[c].angle && i > 0) v = unwrapNear(v, values[c][i - 1] / defs[c].unit);
      values[c].push(v * defs[c].unit);
    }
  }
  return { frames: [...frames], values };
}

/** Frames of the keys of a track. */
export function trackKeyFrames(clip: MotionClip, kind: KeyRef['kind'], track: string): number[] {
  if (kind === 'camera') return clip.camera.map((k) => k.f);
  if (kind === 'morph') return clip.morphs.find((t) => t.name === track)?.keys.map((k) => k.f) ?? [];
  return clip.bones.find((t) => t.name === track)?.keys.map((k) => k.f) ?? [];
}

/**
 * Set one channel of the key at frame `f` to `value` (display units). Rotations are rebuilt from the
 * edited Euler angles and kept in the original quaternion's hemisphere.
 */
export function setChannelValue(
  clip: MotionClip,
  kind: KeyRef['kind'],
  track: string,
  f: number,
  channel: number,
  value: number,
): MotionClip {
  const def = channelDefs(kind)[channel];
  const raw = value / def.unit;
  if (kind === 'morph') {
    return {
      ...clip,
      morphs: clip.morphs.map((t) => {
        if (t.name !== track) return t;
        const i = keyIndexAt(t.keys, f);
        if (i < 0) return t;
        const keys = [...t.keys];
        keys[i] = { ...keys[i], w: raw };
        return { ...t, keys };
      }),
    };
  }
  if (kind === 'camera') {
    const i = keyIndexAt(clip.camera, f);
    if (i < 0) return clip;
    const k = clip.camera[i];
    const next = { ...k, t: [...k.t] as Vec3, r: [...k.r] as Vec3 };
    if (channel < 3) next.t[channel] = raw;
    else if (channel < 6) next.r[channel - 3] = raw;
    else if (channel === 6) next.d = raw;
    else next.fov = Math.max(1, Math.min(179, Math.round(raw)));
    const camera = [...clip.camera];
    camera[i] = next;
    return { ...clip, camera };
  }
  return {
    ...clip,
    bones: clip.bones.map((t) => {
      if (t.name !== track) return t;
      const i = keyIndexAt(t.keys, f);
      if (i < 0) return t;
      const k = t.keys[i];
      const next = { ...k, p: [...k.p] as Vec3, r: [...k.r] as Quat };
      if (channel < 3) next.p[channel] = raw;
      else {
        const e = quatToEuler(k.r);
        e[channel - 3] = raw;
        let q = qnormalize(eulerToQuat(e));
        if (qdot(q, k.r) < 0) q = qneg(q);
        next.r = q;
      }
      const keys = [...t.keys];
      keys[i] = next;
      return { ...t, keys };
    }),
  };
}

/** Curve bytes `[x1, y1, x2, y2]` of channel `curve` of the key at `f` (the segment ending at it). */
export function keyCurve(
  clip: MotionClip,
  kind: KeyRef['kind'],
  track: string,
  f: number,
  curve: number,
): number[] | null {
  if (kind === 'morph' || curve < 0) return null;
  const keys: readonly { f: number; ip: number[] }[] =
    kind === 'camera' ? clip.camera : (clip.bones.find((t) => t.name === track)?.keys ?? []);
  const i = keyIndexAt(keys, f);
  if (i < 0) return null;
  return keys[i].ip.slice(curve * 4, curve * 4 + 4);
}

/** Replace channel `curve` (or every channel when null) of the given keys' curves. */
export function setCurves(
  clip: MotionClip,
  refs: readonly KeyRef[],
  curve: number | null,
  bytes: readonly number[],
): MotionClip {
  const b = bytes.map(clampByte);
  const patch = (ip: number[]): number[] => {
    const out = [...ip];
    const chs = curve === null ? Array.from({ length: ip.length / 4 }, (_, i) => i) : [curve];
    for (const ch of chs) out.splice(ch * 4, 4, ...b);
    return out;
  };
  const byTrack = new Map<string, Set<number>>();
  for (const r of refs) {
    if (r.kind === 'morph') continue;
    const id = r.kind === 'camera' ? CAMERA_TRACK : r.track;
    const s = byTrack.get(id) ?? new Set<number>();
    s.add(r.f);
    byTrack.set(id, s);
  }
  if (!byTrack.size) return clip;
  const cam = byTrack.get(CAMERA_TRACK);
  return {
    ...clip,
    bones: clip.bones.map((t) => {
      const s = byTrack.get(t.name);
      return s ? { ...t, keys: t.keys.map((k) => (s.has(k.f) ? { ...k, ip: patch(k.ip) } : k)) } : t;
    }),
    camera: cam ? clip.camera.map((k) => (cam.has(k.f) ? { ...k, ip: patch(k.ip) } : k)) : clip.camera,
  };
}
