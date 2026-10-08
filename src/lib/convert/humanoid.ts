// Humanoid bone mapping: VRM humanoid map → known rig names (Mixamo, VRoid/Unity, 3ds Max Biped,
// Rigify/Blender) → generic name heuristics → skeleton structure. Each slot gets a confidence.
// Structural matching assumes an oriented model (+Y up, facing +Z, left = +X).

import type { HumanSlot, SourceBone } from './types';

export type MatchVia = 'vrm' | 'dictionary' | 'name' | 'structure' | 'manual';

export interface SlotMatch {
  bone: number;
  confidence: number;
  via: MatchVia;
}

export type HumanMap = Partial<Record<HumanSlot, SlotMatch>>;

export const REQUIRED: HumanSlot[] = [
  'hips', 'spine', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

/** Below this a required slot needs a look in the manual mapping screen. */
export const CONFIDENT = 0.5;

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;
const FINGER_PARTS = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], other: ['Proximal', 'Intermediate', 'Distal'] } as const;

export const ALL_SLOTS: HumanSlot[] = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye', 'jaw',
  ...(['left', 'right'] as const).flatMap((s) => [
    `${s}Shoulder`, `${s}UpperArm`, `${s}LowerArm`, `${s}Hand`,
    `${s}UpperLeg`, `${s}LowerLeg`, `${s}Foot`, `${s}Toes`,
    ...FINGERS.flatMap((f) => (f === 'Thumb' ? FINGER_PARTS.Thumb : FINGER_PARTS.other).map((p) => `${s}${f}${p}`)),
  ] as HumanSlot[]),
];

export const FINGER_SLOTS = (side: 'left' | 'right', f: (typeof FINGERS)[number]): HumanSlot[] =>
  (f === 'Thumb' ? FINGER_PARTS.Thumb : FINGER_PARTS.other).map((p) => `${side}${f}${p}` as HumanSlot);

// ---------------------------------------------------------------- name analysis

const PREFIXES = /^(mixamorig\d*[:_]|armature[|_:]|bip ?0*1[ _]|def[-_]|org[-_]|mch[-_]|j_bip_|j_adj_|j_sec_|cc_base_|rig[:_|]|character\d*[:_])/;

export interface NameInfo {
  side: 'left' | 'right' | null;
  /** Lower-case alphanumeric body with side markers removed. */
  core: string;
  tokens: string[];
  index: number | null;
}

export function analyzeName(raw: string): NameInfo {
  let s = raw.replace(/^.*[:|]/, (m) => (/mixamorig|armature|rig|character/i.test(m) ? '' : m));
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');
  let low = s.toLowerCase().trim();
  for (let i = 0; i < 3; i++) low = low.replace(PREFIXES, '');
  let side: NameInfo['side'] = null;
  if (/左/.test(raw)) side = 'left';
  else if (/右/.test(raw)) side = 'right';
  let tokens = low.split(/[^a-z0-9]+/).filter(Boolean);
  const sideTok = (t: string): NameInfo['side'] => (t === 'l' || t === 'left' || t === 'lft' ? 'left' : t === 'r' || t === 'right' || t === 'rgt' ? 'right' : null);
  tokens = tokens.filter((t) => {
    if (t === 'c' || t === 'center' || t === 'mid') return false;
    const sd = sideTok(t);
    if (sd) side = side ?? sd;
    return !sd;
  });
  const nums = tokens.filter((t) => /^\d+$/.test(t));
  tokens = tokens.filter((t) => !/^\d+$/.test(t));
  return { side, core: tokens.join(''), tokens, index: nums.length ? Number(nums[nums.length - 1]) : null };
}

type Part = 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head' | 'eye' | 'jaw' | 'shoulder' | 'upperArm' | 'lowerArm' | 'hand' | 'upperLeg' | 'lowerLeg' | 'foot' | 'toes' | 'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Little';

/** Body part from a name's core tokens (null = unknown / not a humanoid part). */
export function partOf(info: NameInfo, raw: string): { part: Part; strong: boolean } | null {
  const c = info.core;
  const t = info.tokens;
  const has = (...w: string[]): boolean => w.some((x) => t.includes(x));
  if (/end$|top$/.test(c) && t.length > 1) return null;
  if (/twist|roll|捩|helper|pole|target|ctrl|socket|weapon/.test(c) || /_end$|End$|Nub$/.test(raw)) return null;
  if (has('end', 'nub', 'tip', 'top', 'ik', 'prop', 'ear', 'acc', 'adj') || /^(end|top)/.test(c)) return null;
  if (/hair|髪|skirt|tail|ribbon|cloth|cape|sleeve|breast|bust/.test(c)) return null;
  if (/^(hips?|pelvis|hip)$/.test(c)) return { part: 'hips', strong: true };
  if (c === 'upperchest') return { part: 'upperChest', strong: true };
  if (c === 'chest') return { part: 'chest', strong: true };
  if (c === 'spine') return { part: 'spine', strong: true };
  if (c === 'neck') return { part: 'neck', strong: true };
  if (c === 'head') return { part: 'head', strong: true };
  if (/^(face)?eye$/.test(c)) return { part: 'eye', strong: true };
  if (c === 'jaw') return { part: 'jaw', strong: true };
  if (/^(shoulder|clavicle|collar(bone)?)$/.test(c)) return { part: 'shoulder', strong: true };
  if (/^(upper ?arm|arm|uparm)$/.test(c)) return { part: 'upperArm', strong: true };
  if (/^(fore ?arm|lower ?arm|elbow)$/.test(c)) return { part: 'lowerArm', strong: true };
  if (/^(hand|wrist)$/.test(c)) return { part: 'hand', strong: true };
  if (/^(up ?leg|upper ?leg|thigh)$/.test(c)) return { part: 'upperLeg', strong: true };
  if (/^(leg|lower ?leg|shin|calf|knee)$/.test(c)) return { part: 'lowerLeg', strong: true };
  if (/^(foot|ankle)$/.test(c)) return { part: 'foot', strong: true };
  if (/^(toes?|toe ?base|ball)$/.test(c)) return { part: 'toes', strong: true };
  // Fingers: "hand thumb", "f index", "finger index", "thumb"…
  const f = t.find((x) => /^(thumb|index|middle|ring|little|pinky|pinkie)$/.test(x));
  if (f) return { part: ({ thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring' } as Record<string, Part>)[f] ?? 'Little', strong: true };
  // Looser contains-matches.
  if (has('pelvis', 'hips')) return { part: 'hips', strong: false };
  if (has('neck')) return { part: 'neck', strong: false };
  if (has('head')) return { part: 'head', strong: false };
  if (has('clavicle', 'shoulder')) return { part: 'shoulder', strong: false };
  if (has('forearm', 'elbow')) return { part: 'lowerArm', strong: false };
  if (has('thigh')) return { part: 'upperLeg', strong: false };
  if (has('calf', 'shin', 'knee')) return { part: 'lowerLeg', strong: false };
  if (has('foot', 'ankle')) return { part: 'foot', strong: false };
  if (has('toe', 'toes')) return { part: 'toes', strong: false };
  if (has('hand', 'wrist')) return { part: 'hand', strong: false };
  return null;
}

/** Known rig naming conventions (exact match after prefix stripping ⇒ dictionary confidence). */
const KNOWN_RIG = /^(mixamorig\d*:|J_Bip_|Bip0*1 |DEF-|CC_Base_)|\.(L|R)(\.\d+)?$|^(Hips|Spine\d?|Chest|UpperChest|Neck|Head|(Left|Right)(Shoulder|UpperArm|LowerArm|Hand|UpperLeg|LowerLeg|Foot|Toes|Eye))$/;

// ---------------------------------------------------------------- mapping

export interface MapInput {
  bones: SourceBone[];
  humanoid?: Partial<Record<HumanSlot, number>>;
}

const childrenOf = (bones: SourceBone[]): number[][] => {
  const out: number[][] = bones.map(() => []);
  bones.forEach((b, i) => b.parent >= 0 && out[b.parent].push(i));
  return out;
};

const isAncestor = (bones: SourceBone[], a: number, b: number): boolean => {
  for (let p = bones[b].parent, g = 0; p >= 0 && g < 1000; p = bones[p].parent, g++) if (p === a) return true;
  return false;
};

/** Stage 1–3: VRM map and names. Works in any orientation. */
export function mapByNames(src: MapInput): HumanMap {
  const map: HumanMap = {};
  const set = (slot: HumanSlot, bone: number, confidence: number, via: MatchVia): void => {
    const cur = map[slot];
    if (!cur || cur.confidence < confidence) map[slot] = { bone, confidence, via };
  };
  if (src.humanoid) for (const [slot, bone] of Object.entries(src.humanoid)) if (bone !== undefined) set(slot as HumanSlot, bone, 1, 'vrm');

  const bones = src.bones;
  const kids = childrenOf(bones);
  const infos = bones.map((b) => analyzeName(b.name));
  const parts = bones.map((b, i) => partOf(infos[i], b.name));
  const used = new Set(Object.values(map).map((m) => m!.bone));
  const conf = (i: number, strong: boolean): [number, MatchVia] =>
    KNOWN_RIG.test(bones[i].name) && strong ? [0.95, 'dictionary'] : strong ? [0.8, 'name'] : [0.6, 'name'];

  // Single-instance parts: first (shallowest) strong match wins.
  const depth = (i: number): number => {
    let d = 0;
    for (let p = bones[i].parent; p >= 0; p = bones[p].parent) d++;
    return d;
  };
  const order = bones.map((_, i) => i).sort((a, b) => depth(a) - depth(b));
  for (const i of order) {
    const p = parts[i];
    if (!p || used.has(i)) continue;
    const side = infos[i].side;
    const [c, via] = conf(i, p.strong);
    const sided = (base: string): HumanSlot | null => (side ? (`${side}${base[0].toUpperCase()}${base.slice(1)}` as HumanSlot) : null);
    let slot: HumanSlot | null = null;
    switch (p.part) {
      case 'hips':
      case 'neck':
      case 'head':
      case 'jaw':
      case 'chest':
      case 'upperChest':
        slot = p.part;
        break;
      case 'spine':
        // Numbered spines (Spine, Spine1, Spine2) are resolved from the chain below.
        slot = infos[i].index ? null : 'spine';
        break;
      case 'eye':
        slot = sided('eye');
        break;
      case 'shoulder':
      case 'upperArm':
      case 'lowerArm':
      case 'hand':
      case 'upperLeg':
      case 'lowerLeg':
      case 'foot':
      case 'toes':
        slot = sided(p.part);
        break;
      default:
        break;
    }
    if (slot && (!map[slot] || map[slot]!.confidence < c)) {
      set(slot, i, c, via);
      used.add(i);
    }
  }

  // Spine chain: bones strictly between hips and neck (or head).
  const hips = map.hips?.bone;
  const top = map.neck?.bone ?? map.head?.bone;
  if (hips !== undefined && top !== undefined && isAncestor(bones, hips, top)) {
    const chain: number[] = [];
    for (let p = bones[top].parent; p >= 0 && p !== hips; p = bones[p].parent) chain.unshift(p);
    const c = Math.min(map.hips!.confidence, (map.neck ?? map.head)!.confidence);
    (['spine', 'chest', 'upperChest'] as const).forEach((slot, k) => {
      if (chain[k] !== undefined && (!map[slot] || map[slot]!.via !== 'vrm')) set(slot, chain[k], c, 'name');
    });
  }

  // Fingers: chains under each hand, identified by name, ordered by depth.
  for (const side of ['left', 'right'] as const) {
    const hand = map[`${side}Hand`]?.bone;
    if (hand === undefined) continue;
    for (const f of FINGERS) {
      const slots = FINGER_SLOTS(side, f);
      if (slots.every((s) => map[s]?.via === 'vrm')) continue;
      // Root of this finger's chain: a descendant of the hand whose name says the finger.
      const root = kids[hand].flatMap((c) => [c, ...kids[c]]).find((c) => parts[c]?.part === f);
      if (root === undefined) continue;
      const chain: number[] = [root];
      while (chain.length < 4) {
        const next = kids[chain[chain.length - 1]].find((c) => parts[c]?.part === f || !parts[c]);
        if (next === undefined || /end|nub|tip/i.test(bones[next].name)) break;
        chain.push(next);
      }
      // A 4-bone chain on a non-thumb finger starts at the metacarpal: skip it.
      const use = f !== 'Thumb' && chain.length === 4 ? chain.slice(1) : chain.slice(0, 3);
      use.forEach((b, k) => slots[k] && set(slots[k], b, conf(b, true)[0] * 0.95, 'name'));
    }
  }
  return map;
}

/** Stage 4: fill gaps from the skeleton's shape (oriented model: +Y up, left = +X). */
export function completeByStructure(map: HumanMap, bones: SourceBone[], height: number): HumanMap {
  const out: HumanMap = { ...map };
  const kids = childrenOf(bones);
  const S = 0.45;
  const set = (slot: HumanSlot, bone: number): void => {
    if (!out[slot]) out[slot] = { bone, confidence: S, via: 'structure' };
  };
  const pos = (i: number): [number, number, number] => bones[i].position;
  const subtree = (i: number): number[] => [i, ...kids[i].flatMap(subtree)];
  const used = (): Set<number> => new Set(Object.values(out).map((m) => m!.bone));

  // Hips: the shallowest bone with ≥ 3 child branches spanning above and below it.
  if (!out.hips) {
    for (const [i] of bones.entries()) {
      const k = kids[i].filter((c) => subtree(c).length >= 3);
      if (k.length < 3) continue;
      const ys = k.map((c) => Math.min(...subtree(c).map((b) => pos(b)[1])) - pos(i)[1]);
      if (ys.filter((y) => y < -0.2 * height).length >= 2) {
        set('hips', i);
        break;
      }
    }
  }
  const hips = out.hips?.bone;
  if (hips === undefined) return out;
  const branches = kids[hips];
  const lowest = (c: number): number => Math.min(...subtree(c).map((b) => pos(b)[1]));
  const highest = (c: number): number => Math.max(...subtree(c).map((b) => pos(b)[1]));

  // Legs: branches going down; side by X.
  const legs = branches.filter((c) => lowest(c) < pos(hips)[1] - 0.25 * height && !used().has(c));
  const chainDown = (start: number, n: number): number[] => {
    const out2 = [start];
    while (out2.length < n) {
      const next = kids[out2[out2.length - 1]].sort((a, b) => subtree(b).length - subtree(a).length)[0];
      if (next === undefined) break;
      out2.push(next);
    }
    return out2;
  };
  for (const leg of legs) {
    const side = pos(leg)[0] >= 0 ? 'left' : 'right';
    const c = chainDown(leg, 4);
    // A leg may start with a short hip bone: skip bones that barely go down.
    const startAt = c.length > 1 && pos(c[0])[1] - pos(c[1])[1] < 0.08 * height && kids[c[1]].length ? 1 : 0;
    const chain = chainDown(c[startAt], 4);
    (['UpperLeg', 'LowerLeg', 'Foot', 'Toes'] as const).forEach((p, k) => chain[k] !== undefined && set(`${side}${p}` as HumanSlot, chain[k]));
  }

  // Spine → neck → head: the branch going up.
  const up = branches.filter((c) => highest(c) > pos(hips)[1] + 0.3 * height).sort((a, b) => highest(b) - highest(a))[0];
  if (up !== undefined) {
    // Walk up through the branch: the spine stops where arms branch off; then neck, head.
    const spine: number[] = [];
    let cur = up;
    for (let g = 0; g < 10 && cur !== undefined; g++) {
      spine.push(cur);
      const ch = kids[cur];
      const sideways = ch.filter((c) => Math.abs(Math.max(...subtree(c).map((b) => Math.abs(pos(b)[0])))) > 0.15 * height);
      if (sideways.length >= 2) break;
      cur = ch.sort((a, b) => subtree(b).length - subtree(a).length)[0];
    }
    const top = spine[spine.length - 1];
    ['spine', 'chest', 'upperChest'].forEach((s, k) => spine[k] !== undefined && set(s as HumanSlot, spine[k]));
    // Neck/head: the child of the top going up the most.
    const neck = kids[top].filter((c) => highest(c) > pos(top)[1] + 0.05 * height).sort((a, b) => Math.abs(pos(a)[0]) - Math.abs(pos(b)[0]))[0];
    if (neck !== undefined) {
      set('neck', neck);
      const head = kids[neck].sort((a, b) => subtree(b).length - subtree(a).length)[0];
      if (head !== undefined) set('head', head);
    }
    // Arms: sideways branches of the top.
    for (const arm of kids[top].filter((c) => c !== neck)) {
      const reach = Math.max(...subtree(arm).map((b) => Math.abs(pos(b)[0])));
      if (reach < 0.2 * height) continue;
      const side = pos(subtree(arm).sort((a, b) => Math.abs(pos(b)[0]) - Math.abs(pos(a)[0]))[0])[0] >= 0 ? 'left' : 'right';
      const chain = chainDown(arm, 4);
      // A short first bone near the centre is a shoulder (clavicle).
      const hasShoulder = Math.abs(pos(chain[0])[0]) < 0.06 * height && chain.length >= 4;
      const parts = hasShoulder ? (['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const) : (['UpperArm', 'LowerArm', 'Hand'] as const);
      parts.forEach((p, k) => chain[k] !== undefined && set(`${side}${p}` as HumanSlot, chain[k]));
      // Fingers: hand children ordered front (+Z) to back; thumb = the one most forward / lowest.
      const hand = out[`${side}Hand`]?.bone;
      if (hand === undefined) continue;
      const fingers = kids[hand].filter((c) => !used().has(c)).sort((a, b) => pos(b)[2] - pos(a)[2]);
      fingers.slice(0, 5).forEach((root, fi) => {
        const f = FINGERS[fingers.length >= 5 ? fi : fi + (5 - Math.min(5, fingers.length))];
        chainDown(root, 3).forEach((b, k) => set(FINGER_SLOTS(side, f)[k], b));
      });
    }
  }
  return out;
}

export interface MappingResult {
  map: HumanMap;
  /** Required slots missing or under the confidence threshold. */
  weak: HumanSlot[];
  humanoid: boolean;
}

export function assess(map: HumanMap): MappingResult {
  const weak = REQUIRED.filter((s) => !map[s] || map[s]!.confidence < CONFIDENT);
  const found = REQUIRED.filter((s) => map[s]).length;
  return { map, weak, humanoid: found >= 10 };
}
