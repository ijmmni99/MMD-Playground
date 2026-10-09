// Index bookkeeping for structural edits: name lookup, and removing / reordering bones and morphs while
// keeping every reference (parents, tails, IK, append, weights, morph offsets, frames, rigid bodies) valid.

import type { PmxModel, PmxMorph, V3 } from '@/lib/convert/pmx/types';

export const boneIndex = (m: PmxModel, name: string): number => m.bones.findIndex((b) => b.name === name);
export const morphIndex = (m: PmxModel, name: string): number => m.morphs.findIndex((x) => x.name === name);

/** A name not used by any bone (`name`, `name_2`, `name_3`…). */
export function freeBoneName(m: PmxModel, name: string, taken: ReadonlySet<string> = new Set()): string {
  const used = new Set([...m.bones.map((b) => b.name), ...taken]);
  if (!used.has(name)) return name;
  for (let k = 2; ; k++) if (!used.has(`${name}_${k}`)) return `${name}_${k}`;
}

/** Children (direct) of every bone. */
export function boneChildren(m: PmxModel): number[][] {
  const kids: number[][] = m.bones.map(() => []);
  m.bones.forEach((b, i) => b.parent >= 0 && b.parent < kids.length && kids[b.parent].push(i));
  return kids;
}

/** Bone `i` and all its descendants. */
export function descendants(m: PmxModel, i: number, kids = boneChildren(m)): number[] {
  const out: number[] = [];
  const stack = [i];
  while (stack.length) {
    const c = stack.pop()!;
    out.push(c);
    stack.push(...kids[c]);
  }
  return out;
}

/** True when making `parent` the parent of `child` would create a cycle. */
export function wouldCycle(m: PmxModel, child: number, parent: number): boolean {
  for (let p = parent, guard = 0; p >= 0 && guard <= m.bones.length; guard++) {
    if (p === child) return true;
    p = m.bones[p].parent;
  }
  return false;
}

/** Merge duplicate bones in a vertex's influence list and renormalise. */
export function normaliseInfluences(bones: number[], weights: number[]): [number[], number[]] {
  const acc = new Map<number, number>();
  bones.forEach((b, k) => acc.set(b, (acc.get(b) ?? 0) + Math.max(0, weights[k] ?? 0)));
  let list = [...acc.entries()].filter(([, w]) => w > 1e-6).sort((a, b) => b[1] - a[1]);
  if (!list.length) list = [[bones[0] ?? 0, 1]];
  list = list.slice(0, 4);
  const sum = list.reduce((a, [, w]) => a + w, 0) || 1;
  return [list.map(([b]) => b), list.map(([, w]) => w / sum)];
}

/**
 * Remove a bone. Its children, weights, rigid bodies and append / IK references move to `reassign`
 * (normally the bone's parent). Every index above it shifts down by one.
 */
export function removeBone(m: PmxModel, i: number, reassign = m.bones[i].parent): void {
  if (reassign < 0 || reassign === i)
    throw new Error(`Bone ${m.bones[i].name} has no parent to take its weights`);
  // References to `i` go to `reassign`; every index above `i` shifts down by one.
  const shift = (j: number): number => (j > i ? j - 1 : j);
  const re = (j: number): number => shift(j === i ? reassign : j);
  m.bones.forEach((b, k) => {
    if (k === i) return;
    b.parent = b.parent === -1 ? -1 : re(b.parent);
    if (typeof b.tail === 'number' && b.tail !== -1) {
      if (b.tail === i) b.tail = [0, 0, 0];
      else b.tail = re(b.tail);
    }
    if (b.append) {
      if (b.append.parent === i) delete b.append;
      else b.append.parent = re(b.append.parent);
    }
    if (b.ik) {
      if (b.ik.target === i) delete b.ik;
      else {
        b.ik.target = re(b.ik.target);
        b.ik.links = b.ik.links.filter((l) => l.bone !== i).map((l) => ({ ...l, bone: re(l.bone) }));
      }
    }
  });
  for (const v of m.vertices) {
    if (!v.bones.includes(i)) {
      if (v.bones.some((b) => b > i)) v.bones = v.bones.map(re);
      continue;
    }
    const [b, w] = normaliseInfluences(
      v.bones.map((x) => (x === i ? reassign : x)),
      v.weights,
    );
    v.bones = b.map(shift);
    v.weights = w;
    if (v.bones.length !== 2) delete v.sdef;
    if (v.bones.length !== 4) delete v.qdef;
  }
  for (const r of m.rigidBodies) if (r.bone !== -1) r.bone = re(r.bone);
  for (const mo of m.morphs)
    if (mo.kind === 'bone')
      mo.offsets = mo.offsets.filter((o) => o.bone !== i).map((o) => ({ ...o, bone: re(o.bone) }));
  for (const f of m.frames)
    f.items = f.items
      .filter((it) => !(it.kind === 'bone' && it.index === i))
      .map((it) => (it.kind === 'bone' ? { ...it, index: re(it.index) } : it));
  m.bones.splice(i, 1);
}

/** Apply a morph index permutation: `order[newIndex] = oldIndex`; old indices not in `order` are deleted. */
export function reorderMorphs(m: PmxModel, order: number[]): void {
  const inv = new Map(order.map((old, nu) => [old, nu]));
  const morphs: PmxMorph[] = order.map((old) => m.morphs[old]);
  for (const mo of morphs)
    if (mo.kind === 'group' || mo.kind === 'flip')
      mo.offsets = mo.offsets
        .filter((o) => inv.has(o.morph))
        .map((o) => ({ ...o, morph: inv.get(o.morph)! }));
  for (const f of m.frames)
    f.items = f.items
      .filter((it) => it.kind !== 'morph' || inv.has(it.index))
      .map((it) => (it.kind === 'morph' ? { ...it, index: inv.get(it.index)! } : it));
  m.morphs = morphs;
}

/** Remove rigid bodies (by index set); joints touching them go too, and impulse morphs are remapped. */
export function removeBodies(m: PmxModel, remove: ReadonlySet<number>): void {
  if (!remove.size) return;
  const map: number[] = [];
  let n = 0;
  m.rigidBodies.forEach((_, i) => (map[i] = remove.has(i) ? -1 : n++));
  m.rigidBodies = m.rigidBodies.filter((_, i) => !remove.has(i));
  m.joints = m.joints
    .filter((j) => map[j.a] >= 0 && map[j.b] >= 0)
    .map((j) => ({ ...j, a: map[j.a], b: map[j.b] }));
  for (const mo of m.morphs)
    if (mo.kind === 'impulse')
      mo.offsets = mo.offsets.filter((o) => map[o.body] >= 0).map((o) => ({ ...o, body: map[o.body] }));
}

export const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const len3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const mirrorX = (a: V3): V3 => [-a[0], a[1], a[2]];

/** Mirror partner for a 左 / 右 name (左腕 ↔ 右腕), or null. */
export function mirrorName(name: string): string | null {
  if (name.startsWith('左')) return `右${name.slice(1)}`;
  if (name.startsWith('右')) return `左${name.slice(1)}`;
  if (/_L$|\.L$/.test(name)) return name.replace(/([_.])L$/, '$1R');
  if (/_R$|\.R$/.test(name)) return name.replace(/([_.])R$/, '$1L');
  return null;
}
