// Orientation, scale and grounding. Output stays right-handed (+Y up, facing +Z, left = +X); the
// z-flip into PMX space happens when the PMX is assembled.

import type { HumanMap } from './humanoid';
import type { SourceModel, Vec3 } from './types';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** Apply a linear map to every position-like and direction-like quantity in the model (in place). */
export function transformModel(m: SourceModel, point: (p: Vec3) => Vec3, dir: (d: Vec3) => Vec3, lengthScale = 1): void {
  for (const b of m.bones) b.position = point(b.position);
  for (const mesh of m.meshes) {
    const n = mesh.positions.length / 3;
    for (let v = 0; v < n; v++) {
      const p = point([mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]);
      mesh.positions.set(p, v * 3);
      const d = unit(dir([mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]]));
      mesh.normals.set(d, v * 3);
      for (const mo of mesh.morphs) {
        const x = mo.deltas[v * 3];
        const y = mo.deltas[v * 3 + 1];
        const z = mo.deltas[v * 3 + 2];
        if (x || y || z) mo.deltas.set(dir([x * lengthScale, y * lengthScale, z * lengthScale]), v * 3);
      }
    }
  }
  if (m.springs) {
    for (const c of m.springs.colliders) {
      c.offset = dir(c.offset).map((x) => x * lengthScale) as Vec3;
      if (c.tail) c.tail = dir(c.tail).map((x) => x * lengthScale) as Vec3;
      c.radius *= lengthScale;
    }
    for (const ch of m.springs.chains) for (const j of ch.joints) j.radius *= lengthScale;
  }
}

export function bounds(m: SourceModel): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number, z: number): void => {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  };
  for (const mesh of m.meshes) for (let i = 0; i < mesh.positions.length; i += 3) add(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
  if (!Number.isFinite(min[0])) for (const b of m.bones) add(...b.position);
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 1, 0] };
  return { min, max };
}

export interface OrientResult {
  /** Rows of the applied rotation (left, up, forward in source space). */
  axes: [Vec3, Vec3, Vec3];
  changed: boolean;
  notes: string[];
}

/** Rotate so the model stands up (+Y), faces +Z and has its left side at +X. */
export function orient(m: SourceModel, map: HumanMap): OrientResult {
  const notes: string[] = [];
  const pos = (slot: keyof HumanMap): Vec3 | undefined => (map[slot] ? m.bones[map[slot]!.bone].position : undefined);
  let up: Vec3 = [0, 1, 0];
  const hips = pos('hips');
  const head = pos('head') ?? pos('neck');
  if (hips && head && Math.hypot(...sub(head, hips)) > 1e-6) up = unit(sub(head, hips));
  else {
    const { min, max } = bounds(m);
    const ext = sub(max, min);
    if (ext[2] > ext[1] * 1.5 && ext[2] >= ext[0]) up = [0, 0, 1];
  }
  // Snap to the nearest axis when close (avoid tilting a model whose spine leans a little).
  const snap = (v: Vec3): Vec3 => {
    const i = [0, 1, 2].sort((a, b) => Math.abs(v[b]) - Math.abs(v[a]))[0];
    if (Math.abs(v[i]) > 0.94) {
      const s: Vec3 = [0, 0, 0];
      s[i] = Math.sign(v[i]);
      return s;
    }
    return v;
  };
  up = snap(up);

  let fwd: Vec3 | undefined;
  const lf = pos('leftFoot');
  const lt = pos('leftToes');
  const rf = pos('rightFoot');
  const rt = pos('rightToes');
  if (lf && lt && rf && rt) fwd = unit([lt[0] - lf[0] + rt[0] - rf[0], lt[1] - lf[1] + rt[1] - rf[1], lt[2] - lf[2] + rt[2] - rf[2]]);
  else if (pos('leftEye') && head) fwd = unit(sub(pos('leftEye')!, head));
  // Left arm / leg on the model's left: left × up = forward.
  const la = pos('leftUpperArm') ?? pos('leftUpperLeg');
  const ra = pos('rightUpperArm') ?? pos('rightUpperLeg');
  if (!fwd && la && ra) fwd = unit(cross(sub(la, ra), up));
  if (!fwd) fwd = m.format === 'vrm0' ? [0, 0, -1] : [0, 0, 1];
  fwd = unit(sub(fwd, up.map((u) => u * dot(fwd!, up)) as Vec3));
  if (Math.hypot(...fwd) < 0.5) fwd = Math.abs(up[2]) > 0.9 ? [0, -1, 0] : [0, 0, 1];
  fwd = snap(fwd);
  const left = unit(cross(up, fwd));
  const axes: [Vec3, Vec3, Vec3] = [left, up, fwd];
  const identity = left[0] > 0.999 && up[1] > 0.999 && fwd[2] > 0.999;
  if (!identity) {
    const rot = (v: Vec3): Vec3 => [dot(v, left), dot(v, up), dot(v, fwd)];
    transformModel(m, rot, rot);
    if (up[1] < 0.999) notes.push('Model was not upright: rotated to stand on Y.');
    if (fwd[2] < 0.999) notes.push('Model faced away: turned to face the camera.');
  }
  return { axes, changed: !identity, notes };
}

export interface ScaleResult {
  scale: number;
  sourceHeight: number;
}

/** Scale to `height` units, feet on Y = 0, centred on the hips (or bounds) in X / Z. */
export function scaleAndGround(m: SourceModel, height: number, hipsBone?: number): ScaleResult {
  const { min, max } = bounds(m);
  const sourceHeight = Math.max(1e-6, max[1] - min[1]);
  const s = height / sourceHeight;
  const c = hipsBone !== undefined ? m.bones[hipsBone].position : ([(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2] as Vec3);
  const cx = c[0];
  const cz = c[2];
  const minY = min[1];
  transformModel(
    m,
    (p) => [(p[0] - cx) * s, (p[1] - minY) * s, (p[2] - cz) * s],
    (d) => d,
    s,
  );
  return { scale: s, sourceHeight };
}
