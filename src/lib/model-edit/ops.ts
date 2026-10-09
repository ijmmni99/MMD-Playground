// The non-destructive edit list. `applyOps(original, ops)` folds JSON-serialisable operations over a deep copy
// of the parsed original, in three stages (see MODEL_EDITOR_PLAN.md):
//   1. structural / data ops in list order (bones and morphs by name, materials and rigid bodies by index);
//   2. the last `proportions` op (whole slider state), once;
//   3. the last `outfit` op: hidden groups → alpha 0, their exclusive physics removed, body under clothes hidden.

import type {
  MorphPanel,
  PmxBone,
  PmxDisplayFrame,
  PmxJoint,
  PmxMaterial,
  PmxModel,
  PmxRigidBody,
  V3,
  V4,
} from '@/lib/convert/pmx/types';
import { applyAutoPhysics, applyPhysicsPreset, type PhysicsPresetName } from './physicsEdit';
import { applyProportions, type ProportionState } from './proportions';
import { applyOutfit, type OutfitState } from './outfit';
import { applyMerge, type DonorModel } from './merge';
import {
  boneIndex,
  freeBoneName,
  mirrorName,
  mirrorX,
  morphIndex,
  normaliseInfluences,
  removeBone,
  reorderMorphs,
  wouldCycle,
} from './refs';
import { mirrorVertexMorph } from './morphMirror';
import { cloneModel } from './pmxRead';

export type MaterialPatch = Partial<
  Pick<
    PmxMaterial,
    | 'name'
    | 'nameEn'
    | 'diffuse'
    | 'specular'
    | 'shininess'
    | 'ambient'
    | 'flags'
    | 'edgeColor'
    | 'edgeSize'
    | 'sphereMode'
    | 'sharedToon'
    | 'memo'
  >
>;

export type TextureSlot = 'texture' | 'sphere' | 'toon';

export interface BonePatch {
  nameEn?: string;
  /** Rest position (model space). Children keep their own positions. */
  position?: V3;
  /** Parent bone name ('' = none). */
  parent?: string;
  flags?: number;
  layer?: number;
  tail?: V3 | string;
  fixedAxis?: V3 | null;
  localAxis?: { x: V3; z: V3 } | null;
}

export interface IkSpec {
  target: string;
  loop: number;
  /** Per-iteration angle limit (radians). */
  limit: number;
  links: { bone: string; limit?: { min: V3; max: V3 } }[];
}

export interface FrameSpec {
  name: string;
  nameEn: string;
  special: boolean;
  items: { kind: 'bone' | 'morph'; name: string }[];
}

export type Op =
  | { type: 'material'; index: number; patch: MaterialPatch }
  /** Point a material slot at a texture path (added to the texture list if new); `null` clears it. */
  | { type: 'materialTexture'; index: number; slot: TextureSlot; path: string | null; asset?: string }
  /** Replace a texture file everywhere it is used (retexture, recolour, downscale). */
  | { type: 'textureReplace'; from: string; to: string; asset?: string }
  | { type: 'info'; name?: string; nameEn?: string; comment?: string; commentEn?: string }
  | { type: 'frames'; frames: FrameSpec[] }
  | { type: 'bone'; name: string; patch: BonePatch }
  | { type: 'boneRename'; from: string; to: string; nameEn?: string }
  | { type: 'boneAdd'; name: string; nameEn: string; parent: string; position: V3; flags?: number }
  | { type: 'boneDelete'; name: string }
  | { type: 'ik'; name: string; ik: IkSpec | null }
  /** Copy left-side bone positions / IK limits onto the right side (or the reverse). */
  | { type: 'boneMirror'; from: 'L' | 'R' }
  /** Create (or replace) a group morph. */
  | {
      type: 'morphGroup';
      name: string;
      nameEn: string;
      panel: MorphPanel;
      members: { morph: string; weight: number }[];
    }
  | { type: 'morph'; name: string; patch: { name?: string; nameEn?: string; panel?: MorphPanel } }
  | { type: 'morphDelete'; name: string }
  | { type: 'morphOrder'; names: string[] }
  | { type: 'morphScale'; name: string; factor: number }
  /** Copy a vertex morph's left half onto the right (in place), or into a new morph `to`. */
  | { type: 'morphMirror'; name: string; to?: string; from: 'L' | 'R' }
  | { type: 'rigidBody'; index: number; patch: Partial<PmxRigidBody> }
  | { type: 'joint'; index: number; patch: Partial<PmxJoint> }
  | { type: 'physicsPreset'; bodies: number[]; preset: PhysicsPresetName; sway: number }
  | { type: 'autoPhysics'; bones: string[]; preset: PhysicsPresetName; sway: number }
  /** Weight every vertex of these materials fully to one bone (fix for unweighted accessories). */
  | { type: 'attach'; materials: number[]; bone: string }
  | { type: 'merge'; donor: string; materials: number[]; label: string }
  | { type: 'proportions'; state: ProportionState }
  | { type: 'outfit'; state: OutfitState };

export type OpType = Op['type'];

export interface ApplyContext {
  /** Clothes donors by id (parsed models with their texture files). */
  donors?: Record<string, DonorModel>;
}

export interface ApplyResult {
  pmx: PmxModel;
  /** Texture paths added by edits → project asset ids (files to write next to the PMX). */
  assets: Record<string, string>;
  /** Texture paths a merge brought in → donor id (file comes from that donor). */
  donorFiles: Record<string, { donor: string; path: string }>;
  /** Ops that could not be applied (names missing etc.), in plain language. */
  warnings: string[];
  /** Material indices hidden by the outfit state. */
  hidden: number[];
}

const SINGLETON: ReadonlySet<OpType> = new Set(['proportions', 'outfit', 'frames']);
export const isSingleton = (t: OpType): boolean => SINGLETON.has(t);

function textureSlot(m: PmxModel, path: string | null): number {
  if (path === null) return -1;
  let i = m.textures.indexOf(path);
  if (i < 0) {
    m.textures.push(path);
    i = m.textures.length - 1;
  }
  return i;
}

function applyOne(m: PmxModel, op: Op, res: ApplyResult, ctx: ApplyContext): void {
  const warn = (s: string): void => void res.warnings.push(s);
  const bone = (name: string): number => {
    const i = boneIndex(m, name);
    if (i < 0) warn(`Bone "${name}" not found`);
    return i;
  };
  const morph = (name: string): number => {
    const i = morphIndex(m, name);
    if (i < 0) warn(`Morph "${name}" not found`);
    return i;
  };
  switch (op.type) {
    case 'material': {
      const mat = m.materials[op.index];
      if (!mat) return warn(`Material #${op.index} not found`);
      Object.assign(mat, structuredClone(op.patch));
      return;
    }
    case 'materialTexture': {
      const mat = m.materials[op.index];
      if (!mat) return warn(`Material #${op.index} not found`);
      const t = textureSlot(m, op.path);
      if (op.asset && op.path) res.assets[op.path] = op.asset;
      if (op.slot === 'texture') mat.texture = t;
      else if (op.slot === 'sphere') {
        mat.sphere = t;
        if (t >= 0 && mat.sphereMode === 0) mat.sphereMode = 1;
      } else {
        mat.toon = t;
        if (t >= 0) mat.sharedToon = -1;
      }
      return;
    }
    case 'textureReplace': {
      const i = m.textures.indexOf(op.from);
      if (i < 0) return warn(`Texture ${op.from} not found`);
      const j = m.textures.indexOf(op.to);
      if (j >= 0 && j !== i) {
        // Already listed: point users of `from` at it.
        for (const mat of m.materials) {
          if (mat.texture === i) mat.texture = j;
          if (mat.sphere === i) mat.sphere = j;
          if (mat.toon === i) mat.toon = j;
        }
      } else m.textures[i] = op.to;
      if (op.asset) res.assets[op.to] = op.asset;
      return;
    }
    case 'info':
      for (const k of ['name', 'nameEn', 'comment', 'commentEn'] as const)
        if (op[k] !== undefined) m[k] = op[k]!;
      return;
    case 'frames': {
      m.frames = op.frames.map((f): PmxDisplayFrame => ({
        name: f.name,
        nameEn: f.nameEn,
        special: f.special,
        items: f.items
          .map((it) => ({
            kind: it.kind,
            index: it.kind === 'bone' ? boneIndex(m, it.name) : morphIndex(m, it.name),
          }))
          .filter((it) => it.index >= 0),
      }));
      return;
    }
    case 'bone': {
      const i = bone(op.name);
      if (i < 0) return;
      const b = m.bones[i];
      const p = op.patch;
      if (p.nameEn !== undefined) b.nameEn = p.nameEn;
      if (p.position) b.position = [...p.position];
      if (p.flags !== undefined) b.flags = p.flags;
      if (p.layer !== undefined) b.layer = p.layer;
      if (p.parent !== undefined) {
        const np = p.parent === '' ? -1 : bone(p.parent);
        if (p.parent !== '' && np < 0) return;
        if (np >= 0 && wouldCycle(m, i, np))
          warn(`Bone "${op.name}" can't be parented to its own child "${p.parent}"`);
        else b.parent = np;
      }
      if (p.tail !== undefined) {
        if (typeof p.tail === 'string') {
          const t = bone(p.tail);
          if (t >= 0) b.tail = t;
        } else b.tail = [...p.tail];
      }
      if (p.fixedAxis !== undefined) {
        if (p.fixedAxis) b.fixedAxis = [...p.fixedAxis];
        else delete b.fixedAxis;
      }
      if (p.localAxis !== undefined) {
        if (p.localAxis) b.localAxis = structuredClone(p.localAxis);
        else delete b.localAxis;
      }
      return;
    }
    case 'boneRename': {
      const i = bone(op.from);
      if (i < 0) return;
      if (op.to !== op.from && boneIndex(m, op.to) >= 0)
        return warn(`A bone named "${op.to}" already exists`);
      m.bones[i].name = op.to;
      if (op.nameEn !== undefined) m.bones[i].nameEn = op.nameEn;
      return;
    }
    case 'boneAdd': {
      const parent = bone(op.parent);
      if (parent < 0) return;
      const nb: PmxBone = {
        name: freeBoneName(m, op.name),
        nameEn: op.nameEn,
        position: [...op.position],
        parent,
        layer: m.bones[parent].layer,
        flags: op.flags ?? 0x001a, // rotatable, visible, enabled
        tail: [0, 0.5, 0],
      };
      m.bones.push(nb);
      return;
    }
    case 'boneDelete': {
      const i = bone(op.name);
      if (i < 0) return;
      if (m.bones[i].parent < 0) return warn(`Root bone "${op.name}" can't be deleted`);
      removeBone(m, i);
      return;
    }
    case 'ik': {
      const i = bone(op.name);
      if (i < 0) return;
      const b = m.bones[i];
      if (!op.ik) {
        delete b.ik;
        b.flags &= ~0x20;
        return;
      }
      const target = bone(op.ik.target);
      const links = op.ik.links.map((l) => ({
        bone: bone(l.bone),
        limit: l.limit && structuredClone(l.limit),
      }));
      if (target < 0 || links.some((l) => l.bone < 0)) return;
      b.ik = {
        target,
        loop: op.ik.loop,
        limit: op.ik.limit,
        links: links.map((l) => (l.limit ? { bone: l.bone, limit: l.limit } : { bone: l.bone })),
      };
      b.flags |= 0x20;
      return;
    }
    case 'boneMirror': {
      const src = op.from === 'L' ? '左' : '右';
      m.bones.forEach((b) => {
        if (!b.name.startsWith(src)) return;
        const j = boneIndex(m, mirrorName(b.name)!);
        if (j < 0) return;
        const t = m.bones[j];
        t.position = mirrorX(b.position);
        if (Array.isArray(b.tail) && Array.isArray(t.tail)) t.tail = mirrorX(b.tail);
        if (b.fixedAxis) t.fixedAxis = mirrorX(b.fixedAxis);
        if (b.ik && t.ik) {
          t.ik.loop = b.ik.loop;
          t.ik.limit = b.ik.limit;
          // Rotation limits mirror across the YZ plane: x stays, y / z flip sign and swap min / max.
          t.ik.links.forEach((l, k) => {
            const s = b.ik!.links[k]?.limit;
            if (!s) return;
            l.limit = {
              min: [s.min[0], -s.max[1], -s.max[2]],
              max: [s.max[0], -s.min[1], -s.min[2]],
            };
          });
        }
      });
      return;
    }
    case 'morphGroup': {
      const members = op.members
        .map((x) => ({ morph: morphIndex(m, x.morph), weight: x.weight }))
        .filter((x) => x.morph >= 0 && x.weight !== 0);
      const i = morphIndex(m, op.name);
      const rec = {
        kind: 'group' as const,
        name: op.name,
        nameEn: op.nameEn,
        panel: op.panel,
        offsets: members,
      };
      if (i >= 0) {
        if (m.morphs[i].kind !== 'group') return warn(`"${op.name}" is not a group morph`);
        m.morphs[i] = rec;
        return;
      }
      m.morphs.push(rec);
      const face =
        m.frames.find((f) => f.special && f.items.some((it) => it.kind === 'morph')) ??
        m.frames.find((f) => f.name === '表情');
      face?.items.push({ kind: 'morph', index: m.morphs.length - 1 });
      return;
    }
    case 'morph': {
      const i = morph(op.name);
      if (i < 0) return;
      const mo = m.morphs[i];
      if (op.patch.name !== undefined && op.patch.name !== op.name) {
        if (morphIndex(m, op.patch.name) >= 0) return warn(`A morph named "${op.patch.name}" already exists`);
        mo.name = op.patch.name;
      }
      if (op.patch.nameEn !== undefined) mo.nameEn = op.patch.nameEn;
      if (op.patch.panel !== undefined) mo.panel = op.patch.panel;
      return;
    }
    case 'morphDelete': {
      const i = morph(op.name);
      if (i < 0) return;
      reorderMorphs(
        m,
        m.morphs.map((_, k) => k).filter((k) => k !== i),
      );
      return;
    }
    case 'morphOrder': {
      const named = op.names.map((n) => morphIndex(m, n)).filter((i) => i >= 0);
      const seen = new Set(named);
      reorderMorphs(m, [...named, ...m.morphs.map((_, k) => k).filter((k) => !seen.has(k))]);
      return;
    }
    case 'morphScale': {
      const i = morph(op.name);
      if (i < 0) return;
      const mo = m.morphs[i];
      const f = op.factor;
      if (mo.kind === 'vertex')
        mo.offsets = mo.offsets.map((o) => ({ ...o, offset: o.offset.map((x) => x * f) as V3 }));
      else if (mo.kind === 'uv')
        mo.offsets = mo.offsets.map((o) => ({ ...o, offset: o.offset.map((x) => x * f) as V4 }));
      else if (mo.kind === 'bone')
        mo.offsets = mo.offsets.map((o) => ({ ...o, position: o.position.map((x) => x * f) as V3 }));
      else if (mo.kind === 'group' || mo.kind === 'flip')
        mo.offsets = mo.offsets.map((o) => ({ ...o, weight: o.weight * f }));
      else warn(`Morph "${op.name}" (${mo.kind}) can't be scaled`);
      return;
    }
    case 'morphMirror': {
      const i = morph(op.name);
      if (i < 0) return;
      const mo = m.morphs[i];
      if (mo.kind !== 'vertex')
        return warn(`Only vertex morphs can be mirrored ("${op.name}" is ${mo.kind})`);
      const offsets = mirrorVertexMorph(m, mo.offsets, op.from);
      if (!op.to) {
        mo.offsets = offsets;
        return;
      }
      const j = morphIndex(m, op.to);
      const rec = { ...mo, name: op.to, nameEn: `${mo.nameEn} (mirror)`, offsets };
      if (j >= 0) m.morphs[j] = rec;
      else m.morphs.push(rec);
      return;
    }
    case 'rigidBody': {
      const r = m.rigidBodies[op.index];
      if (!r) return warn(`Rigid body #${op.index} not found`);
      Object.assign(r, structuredClone(op.patch));
      return;
    }
    case 'joint': {
      const j = m.joints[op.index];
      if (!j) return warn(`Joint #${op.index} not found`);
      Object.assign(j, structuredClone(op.patch));
      return;
    }
    case 'physicsPreset':
      applyPhysicsPreset(m, op.bodies, op.preset, op.sway);
      return;
    case 'autoPhysics': {
      const chain = op.bones.map(bone);
      if (chain.some((i) => i < 0)) return;
      applyAutoPhysics(m, chain, op.preset, op.sway);
      return;
    }
    case 'attach': {
      const b = bone(op.bone);
      if (b < 0) return;
      const verts = materialVertices(m, op.materials);
      for (const v of verts) {
        const x = m.vertices[v];
        x.bones = [b];
        x.weights = [1];
        delete x.sdef;
        delete x.qdef;
      }
      return;
    }
    case 'merge': {
      const donor = ctx.donors?.[op.donor];
      if (!donor) return warn(`Clothes source "${op.label}" is not loaded`);
      const r = applyMerge(m, donor, op.materials);
      if (r.error) return warn(r.error);
      for (const [path, from] of Object.entries(r.files))
        res.donorFiles[path] = { donor: op.donor, path: from };
      return;
    }
    case 'proportions':
    case 'outfit':
      return; // later stages
  }
}

/** Vertex indices used by the faces of the given materials. */
export function materialVertices(m: PmxModel, materials: readonly number[]): Set<number> {
  const want = new Set(materials);
  const out = new Set<number>();
  let o = 0;
  m.materials.forEach((mat, k) => {
    if (want.has(k)) for (let i = o; i < o + mat.indexCount; i++) out.add(m.indices[i]);
    o += mat.indexCount;
  });
  return out;
}

export function applyOps(original: PmxModel, ops: readonly Op[], ctx: ApplyContext = {}): ApplyResult {
  const m = cloneModel(original);
  m.indices = Array.from(m.indices);
  const res: ApplyResult = { pmx: m, assets: {}, donorFiles: {}, warnings: [], hidden: [] };
  for (const op of ops) {
    try {
      applyOne(m, op, res, ctx);
    } catch (e) {
      res.warnings.push(`${op.type}: ${(e as Error).message}`);
    }
  }
  const last = <T extends OpType>(t: T): Extract<Op, { type: T }> | undefined =>
    [...ops].reverse().find((o): o is Extract<Op, { type: T }> => o.type === t);
  const prop = last('proportions');
  if (prop) applyProportions(m, prop.state);
  const outfit = last('outfit');
  if (outfit) res.hidden = applyOutfit(m, outfit.state);
  // Weights stay normalised after every edit.
  for (const v of m.vertices) {
    const sum = v.weights.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-4 || v.bones.length > 4) {
      const [b, w] = normaliseInfluences(v.bones, v.weights);
      v.bones = b;
      v.weights = w;
    }
  }
  return res;
}

/** Bones touched by a list of ops (for "reset part" and reports). */
export const opBones = (op: Op): string[] =>
  op.type === 'bone' || op.type === 'ik' || op.type === 'boneDelete'
    ? [op.name]
    : op.type === 'boneRename'
      ? [op.from, op.to]
      : op.type === 'boneAdd'
        ? [op.name]
        : [];

/** One-line description of an op (edit history, README). */
export function describeOp(op: Op): string {
  switch (op.type) {
    case 'material':
      return `Material #${op.index}: ${Object.keys(op.patch).join(', ')}`;
    case 'materialTexture':
      return `Material #${op.index} ${op.slot} → ${op.path ?? 'none'}`;
    case 'textureReplace':
      return `Texture ${op.from} → ${op.to}`;
    case 'info':
      return 'Model info';
    case 'frames':
      return 'Display frames';
    case 'bone':
      return `Bone ${op.name}: ${Object.keys(op.patch).join(', ')}`;
    case 'boneRename':
      return `Rename bone ${op.from} → ${op.to}`;
    case 'boneAdd':
      return `Add bone ${op.name} under ${op.parent}`;
    case 'boneDelete':
      return `Delete bone ${op.name}`;
    case 'ik':
      return `IK ${op.name}`;
    case 'boneMirror':
      return `Mirror bones ${op.from === 'L' ? 'left → right' : 'right → left'}`;
    case 'morphGroup':
      return `Group morph ${op.name} (${op.members.length} members)`;
    case 'morph':
      return `Morph ${op.name}: ${Object.keys(op.patch).join(', ')}`;
    case 'morphDelete':
      return `Delete morph ${op.name}`;
    case 'morphOrder':
      return 'Reorder morphs';
    case 'morphScale':
      return `Scale morph ${op.name} × ${op.factor}`;
    case 'morphMirror':
      return `Mirror morph ${op.name}${op.to ? ` → ${op.to}` : ''}`;
    case 'rigidBody':
      return `Rigid body #${op.index}: ${Object.keys(op.patch).join(', ')}`;
    case 'joint':
      return `Joint #${op.index}: ${Object.keys(op.patch).join(', ')}`;
    case 'physicsPreset':
      return `Physics preset ${op.preset} on ${op.bodies.length} bodies`;
    case 'autoPhysics':
      return `Auto physics for ${op.bones[0]}… (${op.bones.length} bones)`;
    case 'attach':
      return `Attach ${op.materials.length} material(s) to ${op.bone}`;
    case 'merge':
      return `Clothes from ${op.label} (${op.materials.length} material(s))`;
    case 'proportions':
      return 'Proportions';
    case 'outfit':
      return 'Outfit visibility';
  }
}
