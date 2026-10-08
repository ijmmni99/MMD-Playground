// Checks a PmxModel before writing: finite numbers, indices in range, weights summing to 1, no bone
// cycles, material index counts matching the faces.

import type { PmxModel } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

const finite = (v: readonly number[]): boolean => v.every(Number.isFinite);

export function validatePmx(m: PmxModel, files?: ReadonlySet<string>): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const err = (message: string): void => void out.push({ level: 'error', message });
  const warn = (message: string): void => void out.push({ level: 'warning', message });
  const nb = m.bones.length;
  const inBone = (i: number): boolean => i >= 0 && i < nb;

  let badV = 0;
  let badW = 0;
  m.vertices.forEach((v) => {
    if (!finite(v.position) || !finite(v.normal) || !finite(v.uv)) badV++;
    if (!v.bones.length || v.bones.length > 4 || v.bones.length !== v.weights.length || !v.bones.every(inBone)) badV++;
    const sum = v.weights.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-3 || v.weights.some((w) => !(w >= 0))) badW++;
  });
  if (badV) err(`${badV} vertices have invalid numbers or bone references`);
  if (badW) err(`${badW} vertices have weights that don't sum to 1`);

  if (m.indices.length % 3) err('Face index count is not a multiple of 3');
  for (let i = 0; i < m.indices.length; i++) {
    const v = m.indices[i];
    if (!(v >= 0 && v < m.vertices.length)) {
      err(`Face index ${i} (${v}) is out of range`);
      break;
    }
  }
  const matTotal = m.materials.reduce((a, x) => a + x.indexCount, 0);
  if (matTotal !== m.indices.length) err(`Materials cover ${matTotal} indices, faces have ${m.indices.length}`);
  m.materials.forEach((mat) => {
    if (mat.indexCount % 3) err(`Material ${mat.name}: index count not a multiple of 3`);
    for (const t of [mat.texture, mat.sphere]) if (t < -1 || t >= m.textures.length) err(`Material ${mat.name}: texture out of range`);
    if (!finite(mat.diffuse) || !finite(mat.ambient) || !finite(mat.specular)) err(`Material ${mat.name}: invalid colour`);
  });
  if (files) for (const t of m.textures) if (!files.has(t)) warn(`Texture file missing: ${t}`);

  m.bones.forEach((b, i) => {
    if (!finite(b.position)) err(`Bone ${b.name}: invalid position`);
    if (b.parent !== -1 && !inBone(b.parent)) err(`Bone ${b.name}: parent out of range`);
    if (typeof b.tail === 'number' && b.tail !== -1 && !inBone(b.tail)) err(`Bone ${b.name}: tail out of range`);
    if (b.append && !inBone(b.append.parent)) err(`Bone ${b.name}: append parent out of range`);
    if (b.ik) {
      if (!inBone(b.ik.target)) err(`Bone ${b.name}: IK target out of range`);
      if (b.ik.links.some((l) => !inBone(l.bone))) err(`Bone ${b.name}: IK link out of range`);
    }
    // Cycle check.
    let p = b.parent;
    for (let guard = 0; p !== -1 && guard <= nb; guard++) {
      if (p === i) {
        err(`Bone ${b.name}: parent cycle`);
        break;
      }
      p = inBone(p) ? m.bones[p].parent : -1;
    }
  });
  const names = new Set<string>();
  for (const b of m.bones) {
    if (names.has(b.name)) warn(`Duplicate bone name ${b.name}`);
    names.add(b.name);
  }

  m.morphs.forEach((mo) => {
    if (mo.kind === 'vertex') {
      if (mo.offsets.some((x) => x.vertex < 0 || x.vertex >= m.vertices.length || !finite(x.offset)))
        err(`Morph ${mo.name}: bad vertex offset`);
    } else if (mo.offsets.some((x) => x.morph < 0 || x.morph >= m.morphs.length)) err(`Morph ${mo.name}: bad group entry`);
  });
  m.frames.forEach((f) => {
    if (f.items.some((it) => (it.kind === 'bone' ? !inBone(it.index) : it.index < 0 || it.index >= m.morphs.length)))
      err(`Display frame ${f.name}: item out of range`);
  });
  m.rigidBodies.forEach((r) => {
    if (r.bone !== -1 && !inBone(r.bone)) err(`Rigid body ${r.name}: bone out of range`);
    if (!finite(r.size) || !finite(r.position) || !finite(r.rotation) || !(r.mass >= 0)) err(`Rigid body ${r.name}: invalid numbers`);
    if (r.group < 0 || r.group > 15) err(`Rigid body ${r.name}: group out of range`);
  });
  m.joints.forEach((j) => {
    const nr = m.rigidBodies.length;
    if (j.a < 0 || j.a >= nr || j.b < 0 || j.b >= nr) err(`Joint ${j.name}: rigid body out of range`);
  });
  return out;
}
