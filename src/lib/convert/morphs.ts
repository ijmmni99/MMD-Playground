// Face morph mapping: VRM expressions and named morph targets (Japanese, English, ARKit, VRChat
// visemes, VRoid Fcl_*) → MMD morph names, with a review plan the user can edit.

import type { MorphPanel } from './pmx/types';
import type { SourceModel } from './types';

/** MMD morph → panel. */
export const MMD_MORPHS: Record<string, MorphPanel> = {
  まばたき: 2,
  ウィンク: 2,
  ウィンク右: 2,
  笑い: 2,
  なごみ: 2,
  びっくり: 2,
  じと目: 2,
  はぅ: 2,
  あ: 3,
  い: 3,
  う: 3,
  え: 3,
  お: 3,
  にっこり: 3,
  ω: 3,
  ん: 3,
  怒り: 1,
  困る: 1,
  真面目: 1,
  上: 1,
  下: 1,
};

/** VRM 1.0 expression preset → MMD morph. */
export const VRM_PRESET: Record<string, string> = {
  blink: 'まばたき',
  blinkLeft: 'ウィンク',
  blinkRight: 'ウィンク右',
  aa: 'あ',
  ih: 'い',
  ou: 'う',
  ee: 'え',
  oh: 'お',
  happy: '笑い',
  angry: '怒り',
  sad: '困る',
  relaxed: 'なごみ',
  surprised: 'びっくり',
};

/** Normalised synonym → MMD morph (several synonyms → one target ⇒ group morph). */
const SYNONYMS: [string[], string][] = [
  [
    [
      'まばたき',
      'blink',
      'eyeclose',
      'eyesclosed',
      'closeeyes',
      'eyeblink',
      'fcleyeclose',
      'eyeclosed',
      'blinkboth',
    ],
    'まばたき',
  ],
  [
    [
      'ウィンク',
      'blinkleft',
      'blinkl',
      'eyeblinkleft',
      'winkleft',
      'winkl',
      'fcleyecloseL',
      'eyecloseleft',
      'eyeclosel',
    ],
    'ウィンク',
  ],
  [
    [
      'ウィンク右',
      'blinkright',
      'blinkr',
      'eyeblinkright',
      'winkright',
      'winkr',
      'fcleyecloseR',
      'eyecloseright',
      'eyecloser',
    ],
    'ウィンク右',
  ],
  [['あ', 'a', 'aa', 'mouth_a', 'moutha', 'fclmtha', 'vrcvaa', 'jawopen', 'mouthopen', 'vowela'], 'あ'],
  [['い', 'i', 'ih', 'mouthi', 'fclmthi', 'vrcvih', 'vowelI'.toLowerCase()], 'い'],
  [['う', 'u', 'ou', 'mouthu', 'fclmthu', 'vrcvou', 'mouthpucker', 'vowelu'], 'う'],
  [['え', 'e', 'ee', 'mouthe', 'fclmthe', 'vrcve', 'vowele'], 'え'],
  [['お', 'o', 'oh', 'moutho', 'fclmtho', 'vrcvoh', 'mouthfunnel', 'vowelo'], 'お'],
  [['笑い', 'joy', 'happy', 'fclalljoy', 'fcleyejoy', 'smileeyes', 'eyesmile', 'eyejoy'], '笑い'],
  [
    [
      'にっこり',
      'smile',
      'mouthsmile',
      'mouthsmileleft',
      'mouthsmileright',
      'fclmthjoy',
      'fclmthfun',
      'mouthjoy',
    ],
    'にっこり',
  ],
  [
    ['怒り', 'angry', 'anger', 'fclallangry', 'fclbrwangry', 'browdownleft', 'browdownright', 'browangry'],
    '怒り',
  ],
  [['困る', 'sad', 'sorrow', 'troubled', 'fclallsorrow', 'fclbrwsorrow', 'browinnerup', 'browsad'], '困る'],
  [['なごみ', 'fun', 'relaxed', 'fclallfun', 'fcleyefun'], 'なごみ'],
  [
    [
      'びっくり',
      'surprised',
      'surprise',
      'fclallsurprised',
      'fcleyesurprised',
      'eyewideleft',
      'eyewideright',
      'eyewide',
    ],
    'びっくり',
  ],
];

const norm = (s: string): string =>
  s
    .replace(/^.*\./, (m) => (/^(blendshape\d*|blendshapes)\./i.test(m) ? '' : m))
    .toLowerCase()
    .replace(/[\s_\-.]+/g, '');

const SYN = new Map<string, string>();
for (const [words, target] of SYNONYMS) for (const w of words) SYN.set(norm(w), target);
for (const [w, target] of [
  ['瞬き', 'まばたき'],
  ['ウインク', 'ウィンク'],
  ['ウインク右', 'ウィンク右'],
  ['ウィンク左', 'ウィンク'],
  ['ウインク左', 'ウィンク'],
] as const)
  SYN.set(norm(w), target);

/** Standard MMD morph a model's morph name stands for (synonyms in several conventions), if any. */
export const canonicalMorph = (name: string): string | undefined =>
  MMD_MORPHS[name] !== undefined ? name : SYN.get(norm(name));

export interface SourceMorphRef {
  /** Stable key: `m<meshIndex>:<morph>` for glTF, `n:<name>` when grouping by name. */
  key: string;
  name: string;
  /** SourceModel.meshes indices + morph index within each. */
  parts: { mesh: number; morph: number }[];
}

/** Morph targets grouped across primitives of the same mesh (glTF) or by name (FBX). */
export function sourceMorphs(m: SourceModel): SourceMorphRef[] {
  const out = new Map<string, SourceMorphRef>();
  m.meshes.forEach((mesh, mi) =>
    mesh.morphs.forEach((mo, k) => {
      const key = mesh.meshIndex !== undefined ? `m${mesh.meshIndex}:${k}` : `n:${mo.name}`;
      const ref = out.get(key) ?? { key, name: mo.name, parts: [] };
      ref.parts.push({ mesh: mi, morph: k });
      out.set(key, ref);
    }),
  );
  return [...out.values()];
}

export interface MorphPlanEntry {
  /** MMD target (or the original name when kept as-is). */
  target: string;
  /** Source morphs and weights; one entry with weight 1 → a renamed vertex morph, else a group morph. */
  sources: { key: string; weight: number }[];
  /** Matched by: VRM preset, name, or kept. */
  via: 'vrm' | 'name' | 'fuzzy' | 'kept';
  confidence: number;
  enabled: boolean;
}

export interface MorphPlan {
  entries: MorphPlanEntry[];
  morphs: SourceMorphRef[];
}

/** Match one name: exact synonym (1) or a synonym contained in it (0.6). */
export function matchMorphName(name: string): { target: string; confidence: number } | null {
  const n = norm(name);
  if (MMD_MORPHS[name] !== undefined) return { target: name, confidence: 1 };
  const exact = SYN.get(n);
  if (exact) return { target: exact, confidence: 0.95 };
  // Prefixed / suffixed variants ("face_blink_both", "mouth_a_01"): longest synonym inside, ≥ 3 chars.
  let best: { target: string; len: number } | null = null;
  for (const [w, target] of SYN)
    if (w.length >= 3 && n.includes(w) && (!best || w.length > best.len)) best = { target, len: w.length };
  return best ? { target: best.target, confidence: 0.6 } : null;
}

export function planMorphs(m: SourceModel): MorphPlan {
  const morphs = sourceMorphs(m).filter((r) =>
    r.parts.some((p) => m.meshes[p.mesh].morphs[p.morph].deltas.some((d) => d !== 0)),
  );
  const byKey = new Map(morphs.map((r) => [r.key, r]));
  const entries: MorphPlanEntry[] = [];
  const claimed = new Set<string>();
  // VRM expressions first.
  for (const e of m.expressions ?? []) {
    const target = (e.preset && VRM_PRESET[e.preset]) || matchMorphName(e.name)?.target;
    if (!target || entries.some((x) => x.target === target)) continue;
    const sources = e.binds
      .map((b) => ({ key: `m${b.mesh}:${b.morph}`, weight: b.weight }))
      .filter((s) => byKey.has(s.key) && s.weight > 0);
    if (!sources.length) continue;
    entries.push({ target, sources, via: 'vrm', confidence: 1, enabled: true });
    for (const s of sources) if (sources.length === 1 && Math.abs(s.weight - 1) < 1e-3) claimed.add(s.key);
  }
  // Name matching for the rest: several sources for one target become a group (e.g. ARKit L+R blink).
  const byTarget = new Map<string, { key: string; confidence: number }[]>();
  for (const r of morphs) {
    if (claimed.has(r.key)) continue;
    const hit = matchMorphName(r.name);
    if (!hit || entries.some((e) => e.target === hit.target)) continue;
    byTarget.set(hit.target, [
      ...(byTarget.get(hit.target) ?? []),
      { key: r.key, confidence: hit.confidence },
    ]);
  }
  for (const [target, list] of byTarget) {
    const best = Math.max(...list.map((l) => l.confidence));
    const use = list.filter((l) => l.confidence === best);
    entries.push({
      target,
      sources: use.map((l) => ({ key: l.key, weight: 1 })),
      via: best >= 0.9 ? 'name' : 'fuzzy',
      confidence: best,
      enabled: true,
    });
    if (use.length === 1) claimed.add(use[0].key);
  }
  // Both winks but no blink (ARKit): blink = both eyes.
  const wl = entries.find((e) => e.target === 'ウィンク');
  const wr = entries.find((e) => e.target === 'ウィンク右');
  if (wl && wr && !entries.some((e) => e.target === 'まばたき'))
    entries.push({
      target: 'まばたき',
      sources: [...wl.sources, ...wr.sources],
      via: 'fuzzy',
      confidence: Math.min(wl.confidence, wr.confidence),
      enabled: true,
    });
  // Everything else is kept under its own name.
  for (const r of morphs)
    if (!claimed.has(r.key))
      entries.push({
        target: r.name,
        sources: [{ key: r.key, weight: 1 }],
        via: 'kept',
        confidence: 0,
        enabled: true,
      });
  return { entries, morphs };
}

export const panelFor = (name: string): MorphPanel => MMD_MORPHS[name] ?? 4;
