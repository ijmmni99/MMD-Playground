// Clothes swap between models with the same (standard MMD) skeleton. The donor's chosen materials are
// appended with their vertices, faces and textures. Standard bones map by name; any other bone the clothes
// use (skirt chains, ribbons…) is added under its mapped parent with a collision-free name, together with
// its rigid bodies and joints. There is no weight transfer: if the clothes are weighted to a standard bone
// the target lacks, the merge is refused with a clear message.

import type { PmxModel, PmxRigidBody } from '@/lib/convert/pmx/types';
import { boneIndex, freeBoneName } from './refs';
import { isStandardBone } from './standard';

export interface DonorModel {
  pmx: PmxModel;
  label: string;
}

export interface MergeResult {
  error?: string;
  /** New texture paths in the target → path in the donor. */
  files: Record<string, string>;
  /** Indices of the appended materials. */
  materials: number[];
  /** Names of bones added to the target. */
  addedBones: string[];
}

const safe = (s: string): string =>
  s
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'clothes';

/** Check a merge without applying it. */
export function checkMerge(target: PmxModel, donor: PmxModel, materials: readonly number[]): string | null {
  const used = usedBones(donor, materials);
  if (!used.size) return 'The selected materials have no faces.';
  const missing = [...used]
    .map((b) => donor.bones[b].name)
    .filter((n) => isStandardBone(n) && boneIndex(target, n) < 0);
  const standardUsed = [...used].filter((b) => isStandardBone(donor.bones[b].name));
  if (standardUsed.length && missing.length === standardUsed.length)
    return "These models use different skeletons (none of the bones the clothes follow exist here), so the clothes can't be moved over.";
  if (missing.length)
    return `The clothes follow bones this model doesn't have: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}. Clothes can only be moved between models with the same skeleton (no weight transfer).`;
  return null;
}

function faceRanges(m: PmxModel): [number, number][] {
  let o = 0;
  return m.materials.map((mat) => {
    const r: [number, number] = [o, o + mat.indexCount];
    o += mat.indexCount;
    return r;
  });
}

function usedBones(donor: PmxModel, materials: readonly number[]): Set<number> {
  const ranges = faceRanges(donor);
  const out = new Set<number>();
  for (const k of materials) {
    const r = ranges[k];
    if (!r) continue;
    for (let i = r[0]; i < r[1]; i++) {
      const v = donor.vertices[donor.indices[i]];
      v.bones.forEach((b, j) => v.weights[j] > 0 && out.add(b));
    }
  }
  return out;
}

export function applyMerge(m: PmxModel, donorModel: DonorModel, materials: readonly number[]): MergeResult {
  const donor = donorModel.pmx;
  const res: MergeResult = { files: {}, materials: [], addedBones: [] };
  const err = checkMerge(m, donor, materials);
  if (err) return { ...res, error: err };
  const used = usedBones(donor, materials);

  // Bones: standard ones by name, the rest added (with their non-standard ancestors) under the mapped parent.
  const boneMap = new Map<number, number>();
  const taken = new Set<string>();
  const mapBone = (d: number): number => {
    if (d < 0) return -1;
    if (boneMap.has(d)) return boneMap.get(d)!;
    const db = donor.bones[d];
    if (isStandardBone(db.name)) {
      const t = boneIndex(m, db.name);
      if (t >= 0) {
        boneMap.set(d, t);
        return t;
      }
    }
    const parent = db.parent >= 0 ? mapBone(db.parent) : 0;
    const name = freeBoneName(m, db.name, taken);
    taken.add(name);
    m.bones.push({
      ...structuredClone(db),
      name,
      parent: parent >= 0 ? parent : 0,
      tail: Array.isArray(db.tail) ? [...db.tail] : [0, 0, 0],
      ik: undefined,
      append: undefined,
    });
    if (typeof db.tail === 'number') m.bones[m.bones.length - 1].flags &= ~0x0001;
    const t = m.bones.length - 1;
    boneMap.set(d, t);
    res.addedBones.push(name);
    return t;
  };
  for (const b of used) mapBone(b);
  // Bone-index tails between added bones.
  for (const [d, t] of boneMap) {
    const db = donor.bones[d];
    if (res.addedBones.includes(m.bones[t].name) && typeof db.tail === 'number' && boneMap.has(db.tail)) {
      m.bones[t].tail = boneMap.get(db.tail)!;
      m.bones[t].flags |= 0x0001;
    }
  }
  // Children of added bones that only exist for physics (chain tips): add them as well.
  let grew = true;
  while (grew) {
    grew = false;
    donor.bones.forEach((b, i) => {
      if (boneMap.has(i) || b.parent < 0 || !boneMap.has(b.parent)) return;
      if (!res.addedBones.includes(m.bones[boneMap.get(b.parent)!].name) || isStandardBone(b.name)) return;
      mapBone(i);
      grew = true;
    });
  }

  // Textures: copied under tex/<donor>/ with safe, collision-free names.
  const texMap = new Map<number, number>();
  const folder = `tex/${safe(donorModel.label)}`;
  const mapTex = (t: number): number => {
    if (t < 0 || t >= donor.textures.length) return -1;
    if (texMap.has(t)) return texMap.get(t)!;
    const src = donor.textures[t];
    const base = safe(
      src
        .split(/[\\/]/)
        .pop()!
        .replace(/\.[^.]+$/, ''),
    );
    const ext = (/\.[a-z0-9]+$/i.exec(src)?.[0] ?? '.png').toLowerCase();
    let path = `${folder}/${base}${ext}`;
    for (let k = 2; m.textures.includes(path); k++) path = `${folder}/${base}_${k}${ext}`;
    m.textures.push(path);
    res.files[path] = src;
    texMap.set(t, m.textures.length - 1);
    return m.textures.length - 1;
  };

  // Vertices, faces, materials.
  const ranges = faceRanges(donor);
  const vMap = new Map<number, number>();
  const indices = Array.from(m.indices);
  for (const k of materials) {
    const mat = donor.materials[k];
    const r = ranges[k];
    if (!mat || !r) continue;
    for (let i = r[0]; i < r[1]; i++) {
      const dv = donor.indices[i];
      let t = vMap.get(dv);
      if (t === undefined) {
        const v = structuredClone(donor.vertices[dv]);
        v.bones = v.bones.map((b) => boneMap.get(b) ?? 0);
        if (v.addUv && !m.additionalUvCount) delete v.addUv;
        m.vertices.push(v);
        t = m.vertices.length - 1;
        vMap.set(dv, t);
      }
      indices.push(t);
    }
    m.materials.push({
      ...structuredClone(mat),
      texture: mapTex(mat.texture),
      sphere: mapTex(mat.sphere),
      toon: mat.toon !== undefined && mat.toon >= 0 ? mapTex(mat.toon) : mat.toon,
    });
    res.materials.push(m.materials.length - 1);
  }
  // Pad / trim additional UVs to the target's count.
  const n = m.additionalUvCount ?? 0;
  if (n)
    for (const v of vMap.values()) {
      const x = m.vertices[v];
      const a = x.addUv ?? [];
      x.addUv = Array.from({ length: n }, (_, i) => a[i] ?? [0, 0, 0, 0]);
    }
  m.indices = indices;

  // Physics: bodies on added bones, plus bone-following anchors their joints need.
  const added = new Set(res.addedBones.map((nm) => boneIndex(m, nm)));
  const bodyMap = new Map<number, number>();
  const addBody = (i: number, anchor: boolean): number => {
    if (bodyMap.has(i)) return bodyMap.get(i)!;
    const r: PmxRigidBody = structuredClone(donor.rigidBodies[i]);
    r.bone = r.bone >= 0 ? (boneMap.get(r.bone) ?? -1) : -1;
    if (anchor) {
      // Reuse the target's own body on that bone when there is one.
      const own = m.rigidBodies.findIndex((x) => x.bone === r.bone && r.bone >= 0);
      if (own >= 0) {
        bodyMap.set(i, own);
        return own;
      }
      r.mode = 0;
    }
    m.rigidBodies.push(r);
    bodyMap.set(i, m.rigidBodies.length - 1);
    return m.rigidBodies.length - 1;
  };
  donor.rigidBodies.forEach((r, i) => {
    const t = r.bone >= 0 ? boneMap.get(r.bone) : undefined;
    if (t !== undefined && added.has(t)) addBody(i, false);
  });
  for (const j of donor.joints) {
    const a = bodyMap.has(j.a);
    const b = bodyMap.has(j.b);
    if (!a && !b) continue;
    const ra = donor.rigidBodies[j.a];
    const rb = donor.rigidBodies[j.b];
    // The other end must sit on a bone that exists here.
    const other = a ? rb : ra;
    if (!other || (other.bone >= 0 && !boneMap.has(other.bone))) continue;
    m.joints.push({ ...structuredClone(j), a: addBody(j.a, !a), b: addBody(j.b, !b) });
  }

  // A display frame for the added bones.
  if (res.addedBones.length)
    m.frames.push({
      name: `${donorModel.label}`.slice(0, 30),
      nameEn: donorModel.label.slice(0, 30),
      special: false,
      items: res.addedBones.map((nm) => ({ kind: 'bone' as const, index: boneIndex(m, nm) })),
    });
  return res;
}
