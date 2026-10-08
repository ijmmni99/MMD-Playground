// Builds the MMD bone set (standard bones, helpers, leg IK) from a mapped, oriented, scaled model.
// Positions stay in the right-handed working space; `assemble` flips Z when writing PMX.

import { lookupDictionary } from '@/lib/names/dictionary';
import { FINGER_SLOTS, type HumanMap } from './humanoid';
import { BoneFlag, type PmxBone, type V3 } from './pmx/types';
import type { HumanSlot, SourceModel, Vec3 } from './types';

export interface RigOptions {
  /** Add 腕捩 / 手捩 (fixed-axis twist bones). */
  twist: boolean;
  /** Add 足D / ひざD / 足首D and move the leg weights onto them. */
  legD: boolean;
  /** Add 肩P / 肩C. */
  shoulderP: boolean;
  /** Add 腰. */
  waist: boolean;
  /** Static / partial rig: no standard bones or IK. */
  humanoid: boolean;
}

export const DEFAULT_RIG: RigOptions = { twist: true, legD: false, shoulderP: false, waist: false, humanoid: true };

export interface RigResult {
  bones: PmxBone[];
  /** Source bone index → output bone index (weights). */
  remap: number[];
  /** Output index by name. */
  index: Map<string, number>;
  /** Source bones kept as extra bones (output indices). */
  extras: number[];
  /** Output bones that are IK bones / IK parents. */
  ik: number[];
}

const ROT = BoneFlag.Rotatable | BoneFlag.Visible | BoneFlag.Enabled;
const MOVE = ROT | BoneFlag.Movable;

const enName = (ja: string): string => lookupDictionary('bone', ja)?.en ?? ja;

const FINGER_JA: Record<string, string> = { Thumb: '親指', Index: '人指', Middle: '中指', Ring: '薬指', Little: '小指' };
const FW = ['０', '１', '２', '３'];

export function buildRig(m: SourceModel, map: HumanMap, opts: RigOptions): RigResult {
  const bones: PmxBone[] = [];
  const index = new Map<string, number>();
  const remap = new Array<number>(m.bones.length).fill(-1);
  const ik: number[] = [];
  const P = (slot: HumanSlot): Vec3 | undefined => (map[slot] ? ([...m.bones[map[slot]!.bone].position] as Vec3) : undefined);
  const add = (name: string, parent: string | number | null, pos: Vec3, flags = ROT, extra: Partial<PmxBone> = {}): number => {
    const p = parent === null ? -1 : typeof parent === 'number' ? parent : (index.get(parent) ?? -1);
    bones.push({ name, nameEn: enName(name), position: [pos[0], pos[1], pos[2]], parent: p, layer: 0, flags, tail: [0, 0, 0], ...extra });
    index.set(name, bones.length - 1);
    return bones.length - 1;
  };
  const claim = (slot: HumanSlot, out: number): void => {
    const s = map[slot];
    if (s) remap[s.bone] = out;
  };

  const yMax = Math.max(...m.bones.map((b) => b.position[1]), 1);
  const root = add('全ての親', null, [0, 0, 0], MOVE);

  if (!opts.humanoid) {
    // Partial / static rig: keep the source hierarchy under 全ての親 / センター.
    add('センター', root, [0, yMax * 0.4, 0], MOVE);
    keepExtras(m, bones, remap, index, () => index.get('センター')!);
    return finish(bones, remap, index, [], ik);
  }

  const hips = P('hips') ?? [0, yMax * 0.55, 0];
  const centerY = hips[1] * 0.7;
  add('センター', root, [0, centerY, 0], MOVE);
  add('グルーブ', 'センター', [0, centerY + 0.2, 0], MOVE);
  const bodyParent = opts.waist ? add('腰', 'グルーブ', [0, hips[1] - 0.2, hips[2]]) : index.get('グルーブ')!;
  const spine = P('spine') ?? [hips[0], hips[1] + 0.5, hips[2]];
  claim('spine', add('上半身', bodyParent, spine));
  let upper = '上半身';
  const chest = P('chest');
  if (chest) {
    claim('chest', add('上半身2', '上半身', chest));
    upper = '上半身2';
  }
  if (P('upperChest')) {
    claim('upperChest', add('上半身3', upper, P('upperChest')!));
    upper = '上半身3';
  }
  const head = P('head') ?? [spine[0], yMax * 0.9, spine[2]];
  const neck = P('neck') ?? ([(spine[0] + head[0]) / 2, head[1] - 0.6, head[2]] as Vec3);
  claim('neck', add('首', upper, neck));
  claim('head', add('頭', '首', head));
  if (P('jaw')) claim('jaw', add('あご', '頭', P('jaw')!));
  const le = P('leftEye');
  const re = P('rightEye');
  if (le || re) {
    const both: Vec3 = le && re ? [(le[0] + re[0]) / 2, (le[1] + re[1]) / 2, (le[2] + re[2]) / 2] : (le ?? re)!;
    const eyes = add('両目', '頭', [both[0], both[1] + 0.3, both[2]]);
    if (le) claim('leftEye', add('左目', '頭', le, ROT, { append: { parent: eyes, ratio: 1, rotate: true, move: false } }));
    if (re) claim('rightEye', add('右目', '頭', re, ROT, { append: { parent: eyes, ratio: 1, rotate: true, move: false } }));
  }
  claim('hips', add('下半身', bodyParent, hips));

  for (const side of ['left', 'right'] as const) {
    const J = side === 'left' ? '左' : '右';
    const S = (n: string): HumanSlot => `${side}${n}` as HumanSlot;
    const k = side === 'left' ? 1 : -1;
    // Arm.
    const ua = P(S('UpperArm'));
    if (ua) {
      const sh = P(S('Shoulder')) ?? ([ua[0] * 0.35, ua[1] - 0.05, ua[2]] as Vec3);
      let shParent: string = upper;
      if (opts.shoulderP) {
        add(`${J}肩P`, upper, sh);
        shParent = `${J}肩P`;
      }
      claim(S('Shoulder'), add(`${J}肩`, shParent, sh));
      let armParent = `${J}肩`;
      if (opts.shoulderP) {
        add(`${J}肩C`, `${J}肩`, ua, BoneFlag.Rotatable | BoneFlag.Enabled, {
          append: { parent: index.get(`${J}肩P`)!, ratio: -1, rotate: true, move: false },
        });
        armParent = `${J}肩C`;
      }
      const la = P(S('LowerArm')) ?? ([ua[0] + 2.5 * k, ua[1] - 1.5, ua[2]] as Vec3);
      const hand = P(S('Hand')) ?? ([la[0] + 2.5 * k, la[1] - 1.5, la[2]] as Vec3);
      const armAxis = dirOf(ua, la);
      const foreAxis = dirOf(la, hand);
      claim(S('UpperArm'), add(`${J}腕`, armParent, ua, ROT, { localAxis: localAxes(armAxis) }));
      let elbowParent = `${J}腕`;
      if (opts.twist) {
        add(`${J}腕捩`, `${J}腕`, lerp(ua, la, 0.6), ROT, { fixedAxis: armAxis });
        elbowParent = `${J}腕捩`;
      }
      claim(S('LowerArm'), add(`${J}ひじ`, elbowParent, la, ROT, { localAxis: localAxes(foreAxis) }));
      let wristParent = `${J}ひじ`;
      if (opts.twist) {
        add(`${J}手捩`, `${J}ひじ`, lerp(la, hand, 0.6), ROT, { fixedAxis: foreAxis });
        wristParent = `${J}手捩`;
      }
      claim(S('Hand'), add(`${J}手首`, wristParent, hand, ROT, { localAxis: localAxes(foreAxis) }));
      for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const) {
        const slots = FINGER_SLOTS(side, f);
        let parent = `${J}手首`;
        slots.forEach((slot, i) => {
          const p = P(slot);
          if (!p) return;
          const n = f === 'Thumb' ? i : i + 1;
          const name = `${J}${FINGER_JA[f]}${FW[n]}`;
          claim(slot, add(name, parent, p, ROT, { localAxis: localAxes(foreAxis) }));
          parent = name;
        });
      }
    }
    // Leg.
    const ul = P(S('UpperLeg'));
    if (ul) {
      const ll = P(S('LowerLeg')) ?? ([ul[0], ul[1] * 0.55, ul[2]] as Vec3);
      const foot = P(S('Foot')) ?? ([ll[0], ll[1] * 0.15, ll[2]] as Vec3);
      const toes = P(S('Toes')) ?? ([foot[0], Math.max(0, foot[1] * 0.1), foot[2] + Math.max(0.6, foot[1] * 1.1)] as Vec3);
      claim(S('UpperLeg'), add(`${J}足`, '下半身', ul));
      claim(S('LowerLeg'), add(`${J}ひざ`, `${J}足`, ll));
      claim(S('Foot'), add(`${J}足首`, `${J}ひざ`, foot));
      claim(S('Toes'), add(`${J}つま先`, `${J}足首`, toes));
      // IK parents and IK bones.
      const ikParent = add(`${J}足IK親`, root, [foot[0], 0, foot[2]], MOVE);
      const legIk = add(`${J}足ＩＫ`, ikParent, foot, MOVE, {
        ik: {
          target: index.get(`${J}足首`)!,
          loop: 40,
          limit: 2,
          links: [
            // Knees bend one way only, about X (MMD convention), never fully straight (IK stability).
            { bone: index.get(`${J}ひざ`)!, limit: { min: [-Math.PI, 0, 0], max: [(-0.5 * Math.PI) / 180, 0, 0] } },
            { bone: index.get(`${J}足`)! },
          ],
        },
      });
      const toeIk = add(`${J}つま先ＩＫ`, legIk, toes, MOVE, {
        ik: { target: index.get(`${J}つま先`)!, loop: 3, limit: 4, links: [{ bone: index.get(`${J}足首`)! }] },
      });
      ik.push(ikParent, legIk, toeIk);
      if (opts.legD) {
        const d1 = add(`${J}足D`, '下半身', ul, ROT, { append: { parent: index.get(`${J}足`)!, ratio: 1, rotate: true, move: false } });
        const d2 = add(`${J}ひざD`, d1, ll, ROT, { append: { parent: index.get(`${J}ひざ`)!, ratio: 1, rotate: true, move: false } });
        const d3 = add(`${J}足首D`, d2, foot, ROT, { append: { parent: index.get(`${J}足首`)!, ratio: 1, rotate: true, move: false } });
        // Weights follow the D bones (deform after IK, as MMD semi-standard models do).
        for (const [slot, d] of [[S('UpperLeg'), d1], [S('LowerLeg'), d2], [S('Foot'), d3]] as const) if (map[slot]) remap[map[slot]!.bone] = d;
      }
    }
  }

  // Source twist bones go onto 腕捩 / 手捩; other unmapped bones are kept.
  const twistTarget = (i: number): number | undefined => {
    if (!opts.twist || !/twist|roll|捩/i.test(m.bones[i].name)) return undefined;
    for (let p = m.bones[i].parent; p >= 0; p = m.bones[p].parent) {
      for (const side of ['left', 'right'] as const) {
        const J = side === 'left' ? '左' : '右';
        if (map[`${side}UpperArm`]?.bone === p) return index.get(`${J}腕捩`);
        if (map[`${side}LowerArm`]?.bone === p) return index.get(`${J}手捩`);
      }
    }
    return undefined;
  };
  m.bones.forEach((_, i) => {
    if (remap[i] >= 0) return;
    const t = twistTarget(i);
    if (t !== undefined) remap[i] = t;
  });
  const extras = keepExtras(m, bones, remap, index, (i) => {
    // Nearest mapped ancestor; the hips' unmapped children hang off 下半身.
    for (let p = m.bones[i].parent; p >= 0; p = m.bones[p].parent) if (remap[p] >= 0) return remap[p];
    return index.get('センター')!;
  });
  return finish(bones, remap, index, extras, ik);
}

/** Unmapped source bones become extra bones (original names) under their nearest kept ancestor. */
function keepExtras(
  m: SourceModel,
  bones: PmxBone[],
  remap: number[],
  index: Map<string, number>,
  parentFor: (sourceIndex: number) => number,
): number[] {
  const used = new Set<number>();
  for (const mesh of m.meshes) for (let i = 0; i < mesh.joints.length; i++) if (mesh.weights[i] > 0) used.add(mesh.joints[i]);
  const springBones = new Set<number>();
  // Children counts (to drop weightless leaf helpers like HeadTop_End).
  const hasKids = new Set(m.bones.map((b) => b.parent));
  const extras: number[] = [];
  // Parents before children: source order is already parent-first for glTF; sort by depth to be safe.
  const depth = (i: number): number => {
    let d = 0;
    for (let p = m.bones[i].parent; p >= 0; p = m.bones[p].parent) d++;
    return d;
  };
  const order = m.bones.map((_, i) => i).sort((a, b) => depth(a) - depth(b));
  for (const i of order) {
    if (remap[i] >= 0) continue;
    if (!used.has(i) && !hasKids.has(i) && !springBones.has(i) && /end|nub|top|tip/i.test(m.bones[i].name)) continue;
    let name = m.bones[i].name.replace(/^mixamorig\d*:/, '');
    if (index.has(name)) name = `${name}_${i}`;
    bones.push({ name, nameEn: m.bones[i].name, position: [...m.bones[i].position] as V3, parent: parentFor(i), layer: 0, flags: ROT, tail: [0, 0, 0] });
    index.set(name, bones.length - 1);
    remap[i] = bones.length - 1;
    extras.push(bones.length - 1);
  }
  // Dropped helpers weigh nothing, but point them somewhere valid anyway.
  m.bones.forEach((_, i) => {
    if (remap[i] < 0) remap[i] = parentFor(i);
  });
  return extras;
}

function finish(bones: PmxBone[], remap: number[], index: Map<string, number>, extras: number[], ik: number[]): RigResult {
  // Tails: point at the first child (bones read better in MMD); leaves get a short offset.
  const firstChild = new Map<number, number>();
  bones.forEach((b, i) => {
    if (b.parent >= 0 && !firstChild.has(b.parent) && !b.ik && !/IK|ＩＫ|捩|両目|D$/.test(b.name)) firstChild.set(b.parent, i);
  });
  bones.forEach((b, i) => {
    if (b.ik) {
      b.tail = [0, 0, 1];
      return;
    }
    const c = firstChild.get(i);
    b.tail = c !== undefined ? c : [0, 0, 0];
  });
  return { bones, remap, index, extras, ik };
}

function dirOf(a: Vec3, b: Vec3): V3 {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(...d) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Local axes along a limb: X along the bone, Z toward the back (MMD's arm convention). */
function localAxes(x: V3): { x: V3; z: V3 } {
  const back: V3 = [0, 0, -1];
  const d = x[0] * back[0] + x[1] * back[1] + x[2] * back[2];
  const z: V3 = [back[0] - x[0] * d, back[1] - x[1] * d, back[2] - x[2] * d];
  const l = Math.hypot(...z) || 1;
  return { x, z: [z[0] / l, z[1] / l, z[2] / l] };
}
