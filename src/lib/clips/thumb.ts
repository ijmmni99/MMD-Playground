// Stick-figure pose thumbnails: forward kinematics of the model's rest skeleton with a motion's local
// bone transforms (MMD bones have no rest rotation: world = parent ∘ (rest offset + key position)).

import { qmul, rotate, type Quat, type Vec3 } from '@/lib/math3d';

export interface SkeletonInfo {
  bones: { name: string; parent: number; position: [number, number, number] }[];
}

export type PoseSampler = (bone: string) => { p: Vec3; r: Quat } | null;

/** Model-space bone positions for a pose. */
export function posePositions(skel: SkeletonInfo, sample: PoseSampler): Vec3[] {
  const n = skel.bones.length;
  const pos: (Vec3 | undefined)[] = new Array(n);
  const rot: (Quat | undefined)[] = new Array(n);
  const visit = (i: number, depth = 0): void => {
    if (pos[i] || depth > n) return;
    const b = skel.bones[i];
    const s = sample(b.name);
    const lr: Quat = s?.r ?? [0, 0, 0, 1];
    const lp: Vec3 = s?.p ?? [0, 0, 0];
    if (b.parent < 0 || b.parent >= n) {
      pos[i] = [b.position[0] + lp[0], b.position[1] + lp[1], b.position[2] + lp[2]];
      rot[i] = lr;
      return;
    }
    visit(b.parent, depth + 1);
    const pb = skel.bones[b.parent];
    const off: Vec3 = [
      b.position[0] - pb.position[0] + lp[0],
      b.position[1] - pb.position[1] + lp[1],
      b.position[2] - pb.position[2] + lp[2],
    ];
    const pr = rot[b.parent]!;
    const w = rotate(pr, off);
    const pp = pos[b.parent]!;
    pos[i] = [pp[0] + w[0], pp[1] + w[1], pp[2] + w[2]];
    // Row order as in MMD: child rotation applied in the parent's frame.
    rot[i] = qmul(pr, lr);
  };
  for (let i = 0; i < n; i++) visit(i);
  return pos as Vec3[];
}

/** Bones worth drawing: everything except IK targets / their children and root helpers. */
export function figureSegments(skel: SkeletonInfo): [number, number][] {
  const skip = new Set<number>();
  const isIk = (name: string): boolean => /IK|ＩＫ/.test(name);
  skel.bones.forEach((_b, i) => {
    let j = i;
    for (let guard = 0; j >= 0 && guard < 64; guard++) {
      if (isIk(skel.bones[j].name)) {
        skip.add(i);
        break;
      }
      j = skel.bones[j].parent;
    }
  });
  const roots = new Set(['全ての親', 'センター', 'グルーブ', '操作中心']);
  const out: [number, number][] = [];
  skel.bones.forEach((b, i) => {
    if (skip.has(i) || b.parent < 0 || skip.has(b.parent)) return;
    if (roots.has(skel.bones[b.parent].name) && roots.has(b.name)) return;
    out.push([b.parent, i]);
  });
  return out;
}
