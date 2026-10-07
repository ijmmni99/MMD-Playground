import { qdistance, slerp, type Quat, type Vec3 } from './math';
import type { BoneKey } from './vmdWriter';

const DEG = Math.PI / 180;

/**
 * Douglas–Peucker style keyframe reduction per bone. A frame is dropped when the linear VMD interpolation
 * between the kept neighbours (slerp for rotation, lerp for position) reproduces it within tolerance.
 *
 * @param rotationTolerance degrees
 * @param positionTolerance MMD units
 */
export function reduceKeys(keys: BoneKey[], rotationTolerance: number, positionTolerance: number): BoneKey[] {
  if (rotationTolerance <= 0 && positionTolerance <= 0) return keys;
  const byBone = new Map<string, BoneKey[]>();
  for (const k of keys) {
    const list = byBone.get(k.bone);
    if (list) list.push(k);
    else byBone.set(k.bone, [k]);
  }
  const out: BoneKey[] = [];
  const rotTol = Math.max(1e-6, rotationTolerance * DEG);
  const posTol = Math.max(1e-6, positionTolerance);
  for (const list of byBone.values()) {
    list.sort((a, b) => a.frame - b.frame);
    if (list.length <= 2) {
      out.push(...list);
      continue;
    }
    const keep = new Uint8Array(list.length);
    keep[0] = 1;
    keep[list.length - 1] = 1;
    const stack: [number, number][] = [[0, list.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      if (b - a < 2) continue;
      const ka = list[a];
      const kb = list[b];
      let worst = -1;
      let worstScore = 1;
      for (let i = a + 1; i < b; i++) {
        const t = (list[i].frame - ka.frame) / (kb.frame - ka.frame);
        const q = slerp(ka.rotation as Quat, kb.rotation as Quat, t);
        const rotErr = qdistance(q, list[i].rotation as Quat) / rotTol;
        const p: Vec3 = [0, 1, 2].map((c) => ka.position[c] + (kb.position[c] - ka.position[c]) * t) as Vec3;
        const posErr =
          Math.hypot(p[0] - list[i].position[0], p[1] - list[i].position[1], p[2] - list[i].position[2]) /
          posTol;
        const score = Math.max(rotErr, posErr);
        if (score > worstScore) {
          worstScore = score;
          worst = i;
        }
      }
      if (worst >= 0) {
        keep[worst] = 1;
        stack.push([a, worst], [worst, b]);
      }
    }
    list.forEach((k, i) => keep[i] && out.push(k));
  }
  return out;
}

/** Tolerance setting (degrees) → position tolerance in MMD units. */
export const positionToleranceFor = (degrees: number): number => degrees * 0.05;
