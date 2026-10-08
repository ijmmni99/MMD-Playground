// Rest-pose normalization: T-pose (or any arm angle) → MMD A-pose by rotating each arm chain about
// its shoulder joint and re-skinning the mesh to the new rest pose (weights unchanged).

import type { HumanMap } from './humanoid';
import type { SourceModel, Vec3 } from './types';

export type RestPose = 'T-pose' | 'A-pose' | 'other';

/** Upper arm direction below horizontal (degrees) for one side; null when the arm isn't mapped. */
export function armAngle(m: SourceModel, map: HumanMap, side: 'left' | 'right'): number | null {
  const a = map[`${side}UpperArm`];
  const b = map[`${side}LowerArm`] ?? map[`${side}Hand`];
  if (!a || !b) return null;
  const p = m.bones[a.bone].position;
  const q = m.bones[b.bone].position;
  const out = Math.abs(q[0] - p[0]);
  const down = p[1] - q[1];
  return (Math.atan2(down, Math.max(1e-9, Math.hypot(out, q[2] - p[2]))) * 180) / Math.PI;
}

export function detectRestPose(m: SourceModel, map: HumanMap): { pose: RestPose; angle: number | null } {
  const l = armAngle(m, map, 'left');
  const r = armAngle(m, map, 'right');
  const angles = [l, r].filter((x): x is number => x !== null);
  if (!angles.length) return { pose: 'other', angle: null };
  const a = angles.reduce((s, x) => s + x, 0) / angles.length;
  return { pose: a < 15 ? 'T-pose' : a >= 25 && a <= 50 ? 'A-pose' : 'other', angle: a };
}

const subtreeOf = (m: SourceModel, root: number): Set<number> => {
  const kids: number[][] = m.bones.map(() => []);
  m.bones.forEach((b, i) => b.parent >= 0 && kids[b.parent].push(i));
  const out = new Set<number>();
  const walk = (i: number): void => {
    out.add(i);
    kids[i].forEach(walk);
  };
  walk(root);
  return out;
};

/** Rotate (x, y) about the forward (Z) axis through a pivot. */
const rotZ = (p: Vec3, pivot: Vec3, c: number, s: number): Vec3 => {
  const x = p[0] - pivot[0];
  const y = p[1] - pivot[1];
  return [pivot[0] + x * c - y * s, pivot[1] + x * s + y * c, p[2]];
};

/**
 * Rotate both arms to `targetDeg` below horizontal and re-skin (in place). Returns the rotation applied
 * per side in degrees (0 when the side was already there or isn't mapped).
 */
export function rebindArms(m: SourceModel, map: HumanMap, targetDeg: number): { left: number; right: number } {
  const applied = { left: 0, right: 0 };
  for (const side of ['left', 'right'] as const) {
    const cur = armAngle(m, map, side);
    const upper = map[`${side}UpperArm`];
    if (cur === null || !upper) continue;
    const delta = targetDeg - cur;
    if (Math.abs(delta) < 0.5) continue;
    // Left arm points +X: lowering it rotates about +Z by −delta; the right arm by +delta.
    const ang = ((side === 'left' ? -delta : delta) * Math.PI) / 180;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const pivot: Vec3 = [...m.bones[upper.bone].position];
    const chain = subtreeOf(m, upper.bone);
    for (const b of chain) m.bones[b].position = rotZ(m.bones[b].position, pivot, c, s);
    for (const mesh of m.meshes) {
      const n = mesh.positions.length / 3;
      for (let v = 0; v < n; v++) {
        let f = 0;
        for (let k = 0; k < 4; k++) if (chain.has(mesh.joints[v * 4 + k])) f += mesh.weights[v * 4 + k];
        if (f <= 0) continue;
        const p: Vec3 = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
        const r = rotZ(p, pivot, c, s);
        mesh.positions.set([p[0] + (r[0] - p[0]) * f, p[1] + (r[1] - p[1]) * f, p[2]], v * 3);
        const blendDir = (x: number, y: number): [number, number] => {
          const rx = x * c - y * s;
          const ry = x * s + y * c;
          return [x + (rx - x) * f, y + (ry - y) * f];
        };
        const [nx, ny] = blendDir(mesh.normals[v * 3], mesh.normals[v * 3 + 1]);
        const nz = mesh.normals[v * 3 + 2];
        const l = Math.hypot(nx, ny, nz) || 1;
        mesh.normals.set([nx / l, ny / l, nz / l], v * 3);
        for (const mo of mesh.morphs) {
          const [dx, dy] = blendDir(mo.deltas[v * 3], mo.deltas[v * 3 + 1]);
          mo.deltas[v * 3] = dx;
          mo.deltas[v * 3 + 1] = dy;
        }
      }
    }
    applied[side] = delta;
  }
  return applied;
}
