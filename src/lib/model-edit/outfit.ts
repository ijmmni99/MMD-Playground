// Outfit groups: materials sorted into Hair / Face / Body / Top / Bottom / Shoes / Gloves / Accessories /
// Other by name patterns (Japanese and English names, texture file names), with manual overrides and custom
// groups. Hiding a group makes its materials invisible (alpha 0, no edge) and removes the physics of bones
// only it uses. "Hide body under outfit" collapses the body triangles covered by a visible clothing group.

import type { PmxModel } from '@/lib/convert/pmx/types';
import { removeBodies } from './refs';

export const BUILTIN_GROUPS = [
  'hair',
  'face',
  'body',
  'top',
  'bottom',
  'shoes',
  'gloves',
  'accessories',
  'other',
] as const;
export type BuiltinGroup = (typeof BUILTIN_GROUPS)[number];

export const GROUP_LABEL: Record<BuiltinGroup, string> = {
  hair: 'Hair',
  face: 'Face',
  body: 'Body',
  top: 'Top',
  bottom: 'Bottom / Skirt',
  shoes: 'Shoes',
  gloves: 'Gloves',
  accessories: 'Accessories',
  other: 'Other',
};

/** Clothing groups (hiding them may expose the body). */
export const CLOTHING: ReadonlySet<string> = new Set(['top', 'bottom', 'shoes', 'gloves']);

export interface OutfitState {
  /** Manual group per material index (overrides auto-grouping). Values are group ids. */
  assign: Record<number, string>;
  /** Hidden group ids. */
  hidden: string[];
  /** Individually hidden materials (Materials panel visibility). */
  hiddenMaterials: number[];
  /** Clothing groups whose covered body is hidden. */
  hideBodyUnder: string[];
  /** Custom groups. */
  custom: { id: string; label: string }[];
}

export const EMPTY_OUTFIT: OutfitState = {
  assign: {},
  hidden: [],
  hiddenMaterials: [],
  hideBodyUnder: [],
  custom: [],
};

const RULES: [RegExp, BuiltinGroup][] = [
  [/手袋|グローブ|ミトン|glove|mitten/i, 'gloves'],
  [
    /靴|シューズ|ブーツ|ソックス|靴下|ニーソ|ストッキング|タイツ|サンダル|ヒール|shoe|boot|sock|stocking|tights|sandal|heel|sneaker/i,
    'shoes',
  ],
  [/髪飾|ヘアピン|ヘアバンド|カチューシャ|hair_?(pin|clip|band|acc|orn)|headband/i, 'accessories'],
  [/髪|ヘア|前髪|後髪|横髪|もみあげ|アホ毛|hair|bang|fringe|ponytail|twintail|ahoge/i, 'hair'],
  [
    /顔|目|瞳|白目|眉|まゆ|まつ|睫|口|歯|舌|頬|ほお|表情|ハイライト|face|eye|iris|pupil|brow|lash|mouth|teeth|tooth|tongue|cheek|blush|head_?skin/i,
    'face',
  ],
  [
    /スカート|パンツ|ズボン|ショーツ|ショートパンツ|ブルマ|下着|skirt|pants|trouser|shorts|jeans|bottom|underwear|panties|bloomers/i,
    'bottom',
  ],
  [
    /服|上着|トップス|シャツ|ジャケット|コート|ブラウス|セーラー|ベスト|パーカー|セーター|ドレス|ワンピ|制服|袖|衿|襟|インナー|ブラ|cloth|top|shirt|jacket|coat|blouse|sailor|vest|hoodie|parka|sweater|dress|uniform|sleeve|collar|inner|bra\b|tunic|cape|マント/i,
    'top',
  ],
  [/体|肌|素体|身体|手|腕|足|脚|首|胸|skin|body|arm|hand|leg|neck|torso|chest|nail|爪/i, 'body'],
  [
    /リボン|アクセ|帽子|ハット|キャップ|ネックレス|イヤリング|ピアス|眼鏡|メガネ|ヘッドホン|バッグ|ベルト|指輪|羽|翼|尻尾|しっぽ|耳|ネクタイ|タイ|ボタン|チョーカー|ribbon|acc|hat|cap\b|necklace|earring|piercing|glasses|headphone|bag|belt|ring|wing|tail|ear\b|ears|tie\b|button|choker|bow\b|crown|halo/i,
    'accessories',
  ],
];

/** Auto group for one material (name, English name, texture file name). */
export function guessGroup(name: string, nameEn: string, texture = ''): BuiltinGroup {
  const file =
    texture
      .split('/')
      .pop()
      ?.replace(/\.[a-z0-9]+$/i, '') ?? '';
  for (const s of [name, nameEn, file]) {
    if (!s) continue;
    for (const [re, g] of RULES) if (re.test(s)) return g;
  }
  return 'other';
}

/** Group id per material (auto + overrides). */
export function materialGroups(m: PmxModel, state: OutfitState = EMPTY_OUTFIT): string[] {
  return m.materials.map(
    (mat, i) =>
      state.assign[i] ??
      guessGroup(mat.name, mat.nameEn, mat.texture >= 0 ? (m.textures[mat.texture] ?? '') : ''),
  );
}

/** Per material: the vertex ranges of its faces. */
function faceRanges(m: PmxModel): [number, number][] {
  const out: [number, number][] = [];
  let o = 0;
  for (const mat of m.materials) {
    out.push([o, o + mat.indexCount]);
    o += mat.indexCount;
  }
  return out;
}

/** Bone use per material set: bone → summed vertex weight. */
function boneUse(m: PmxModel, mats: ReadonlySet<number>, ranges = faceRanges(m)): Map<number, number> {
  const seen = new Set<number>();
  const use = new Map<number, number>();
  mats.forEach((k) => {
    const [a, b] = ranges[k] ?? [0, 0];
    for (let i = a; i < b; i++) {
      const v = m.indices[i];
      if (seen.has(v)) continue;
      seen.add(v);
      const x = m.vertices[v];
      x.bones.forEach((bo, j) => use.set(bo, (use.get(bo) ?? 0) + x.weights[j]));
    }
  });
  return use;
}

/** Bones whose skinned vertices belong only to the given materials. */
export function exclusiveBones(m: PmxModel, mats: ReadonlySet<number>): Set<number> {
  const ranges = faceRanges(m);
  const inside = boneUse(m, mats, ranges);
  const others = new Set(m.materials.map((_, i) => i).filter((i) => !mats.has(i)));
  const outside = boneUse(m, others, ranges);
  const out = new Set<number>();
  for (const b of inside.keys()) if (!outside.has(b)) out.add(b);
  // Descendants of exclusive bones with no skinning at all (chain tips) go too.
  let grew = true;
  while (grew) {
    grew = false;
    m.bones.forEach((b, i) => {
      if (!out.has(i) && out.has(b.parent) && !outside.has(i)) {
        out.add(i);
        grew = true;
      }
    });
  }
  return out;
}

/** Bones a group covers (≥ 3 vertices mostly weighted to them). */
function coveredBones(m: PmxModel, mats: ReadonlySet<number>, ranges = faceRanges(m)): Set<number> {
  const count = new Map<number, number>();
  const seen = new Set<number>();
  mats.forEach((k) => {
    const [a, b] = ranges[k] ?? [0, 0];
    for (let i = a; i < b; i++) {
      const v = m.indices[i];
      if (seen.has(v)) continue;
      seen.add(v);
      const x = m.vertices[v];
      const j = x.weights.indexOf(Math.max(...x.weights));
      count.set(x.bones[j], (count.get(x.bones[j]) ?? 0) + 1);
    }
  });
  return new Set([...count].filter(([, n]) => n >= 3).map(([b]) => b));
}

/** Materials hidden by a state. */
export function hiddenMaterials(m: PmxModel, state: OutfitState): number[] {
  const groups = materialGroups(m, state);
  const hidden = new Set(state.hidden);
  const extra = new Set(state.hiddenMaterials);
  return m.materials.map((_, i) => i).filter((i) => hidden.has(groups[i]) || extra.has(i));
}

/** Apply in place; returns the hidden material indices. */
export function applyOutfit(m: PmxModel, state: OutfitState): number[] {
  const groups = materialGroups(m, state);
  const hidden = hiddenMaterials(m, state);
  const hiddenSet = new Set(hidden);
  const ranges = faceRanges(m);

  // Body under visible clothing: collapse triangles whose three vertices are mostly weighted to covered bones.
  for (const g of state.hideBodyUnder) {
    const clothes = new Set(
      groups.map((x, i) => (x === g && !hiddenSet.has(i) ? i : -1)).filter((i) => i >= 0),
    );
    if (!clothes.size) continue;
    const covered = coveredBones(m, clothes, ranges);
    const dominant = (v: number): number => {
      const x = m.vertices[v];
      return x.bones[x.weights.indexOf(Math.max(...x.weights))];
    };
    groups.forEach((x, k) => {
      if (x !== 'body') return;
      const [a, b] = ranges[k];
      for (let i = a; i < b; i += 3) {
        const t = [m.indices[i], m.indices[i + 1], m.indices[i + 2]];
        if (t.every((v) => covered.has(dominant(v)))) {
          m.indices[i + 1] = t[0];
          m.indices[i + 2] = t[0];
        }
      }
    });
  }

  if (!hidden.length) return hidden;
  for (const i of hidden) {
    const mat = m.materials[i];
    mat.diffuse = [mat.diffuse[0], mat.diffuse[1], mat.diffuse[2], 0];
    mat.flags &= ~(0x10 | 0x02 | 0x04); // no edge, no ground shadow, no shadow map
  }
  // Physics of bones only the hidden materials use.
  const only = exclusiveBones(m, hiddenSet);
  const drop = new Set<number>();
  m.rigidBodies.forEach((r, i) => r.bone >= 0 && only.has(r.bone) && drop.add(i));
  // Bone-following anchors whose every joint led into dropped bodies go too.
  const linked = new Map<number, number[]>();
  for (const j of m.joints) {
    linked.set(j.a, [...(linked.get(j.a) ?? []), j.b]);
    linked.set(j.b, [...(linked.get(j.b) ?? []), j.a]);
  }
  if (drop.size)
    m.rigidBodies.forEach((r, i) => {
      const l = linked.get(i);
      if (r.mode === 0 && l?.length && l.every((o) => drop.has(o))) drop.add(i);
    });
  removeBodies(m, drop);
  return hidden;
}

/** Plain-language warnings for a state (holes when clothing is hidden with no body underneath). */
export function outfitWarnings(m: PmxModel, state: OutfitState): string[] {
  const groups = materialGroups(m, state);
  const ranges = faceRanges(m);
  const body = new Set(groups.map((g, i) => (g === 'body' ? i : -1)).filter((i) => i >= 0));
  const bodyBones = boneUse(m, body, ranges);
  const out: string[] = [];
  for (const g of state.hidden) {
    if (!CLOTHING.has(g)) continue;
    const mats = new Set(groups.map((x, i) => (x === g ? i : -1)).filter((i) => i >= 0));
    const missing = [...coveredBones(m, mats, ranges)].filter((b) => !bodyBones.has(b));
    if (missing.length)
      out.push(
        `Hiding ${GROUP_LABEL[g as BuiltinGroup] ?? g} may leave holes: no body mesh under ${missing
          .slice(0, 3)
          .map((b) => m.bones[b].name)
          .join(', ')}${missing.length > 3 ? '…' : ''}`,
      );
  }
  return out;
}
