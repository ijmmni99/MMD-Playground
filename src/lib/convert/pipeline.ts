// SourceModel → PmxModel: mapping, orientation, scale, A-pose rebind, MMD rig + IK, mesh assembly
// (z-flip + winding), materials, morphs, physics, display frames, validation and a report.

import { assess, completeByStructure, mapByNames, type HumanMap, type MappingResult } from './humanoid';
import { texturePaths, toPmxMaterial } from './materials';
import { panelFor, planMorphs, type MorphPlan } from './morphs';
import { orient, scaleAndGround } from './normalize';
import { buildPhysics, classify, DEFAULT_PHYSICS, detectChains, presetFor, type ChainPreset, type PhysicsChain, type PhysicsOptions } from './physics';
import type { PmxBone, PmxDisplayFrame, PmxMaterial, PmxModel, PmxMorph, PmxVertex, V3 } from './pmx/types';
import { validatePmx, type ValidationIssue } from './pmx/validate';
import { detectRestPose, rebindArms, type RestPose } from './pose';
import { buildRig, DEFAULT_RIG, type RigOptions } from './rig';
import type { HumanSlot, SourceModel } from './types';

export interface ConvertOptions {
  /** Model height in MMD units (20 ≈ a 1.6 m character). */
  height: number;
  /** Bring the arms to the MMD A-pose (re-skinned). */
  aPose: boolean;
  /** A-pose arm angle below horizontal (degrees). */
  armAngle: number;
  rig: Omit<RigOptions, 'humanoid'>;
  physics: PhysicsOptions;
  /** Manual mapping: slot → source bone index, or null to unmap. */
  mapping: Partial<Record<HumanSlot, number | null>>;
  /** Morph plan edits keyed by the entry's first source key (`target` rename, or disable). */
  morphEdits: Record<string, { target?: string; enabled?: boolean }>;
  /** Physics chain edits keyed by chain id. */
  chainEdits: Record<string, { enabled?: boolean; preset?: ChainPreset }>;
  /** Treat as a static / partial rig even when it looks humanoid. */
  forceStatic?: boolean;
  name?: string;
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  height: 20,
  aPose: true,
  armAngle: 35,
  rig: { twist: DEFAULT_RIG.twist, legD: DEFAULT_RIG.legD, shoulderP: DEFAULT_RIG.shoulderP, waist: DEFAULT_RIG.waist },
  physics: DEFAULT_PHYSICS,
  mapping: {},
  morphEdits: {},
  chainEdits: {},
};

export interface ConversionReport {
  source: { name: string; format: SourceModel['format']; bones: number; vertices: number; triangles: number; materials: number; morphs: number };
  output: { bones: number; vertices: number; materials: number; morphs: number; rigidBodies: number; joints: number };
  humanoid: boolean;
  restPose: RestPose;
  armAngle: number | null;
  armRotation: { left: number; right: number };
  scale: number;
  mapping: { slot: HumanSlot; bone: string; confidence: number; via: string }[];
  weakSlots: HumanSlot[];
  unmappedBones: string[];
  fixes: string[];
  warnings: string[];
  tips: string[];
}

export interface ConvertResult {
  pmx: PmxModel;
  /** Output texture paths and the SourceModel texture each one comes from. */
  textures: { path: string; source: number }[];
  map: HumanMap;
  mapping: MappingResult;
  morphPlan: MorphPlan;
  chains: PhysicsChain[];
  validation: ValidationIssue[];
  report: ConversionReport;
  /** Normalised source (oriented, scaled, A-posed), for previews. */
  model: SourceModel;
}

const flip = (v: readonly number[]): V3 => [v[0], v[1], -v[2]];

export function convertModel(src: SourceModel, options: Partial<ConvertOptions> = {}): ConvertResult {
  const opts: ConvertOptions = { ...DEFAULT_OPTIONS, ...options, rig: { ...DEFAULT_OPTIONS.rig, ...options.rig }, physics: { ...DEFAULT_OPTIONS.physics, ...options.physics } };
  const m: SourceModel = structuredClone(src);
  const fixes: string[] = [];
  const warnings: string[] = [...m.warnings];
  const manual = (map: HumanMap): HumanMap => {
    const out = { ...map };
    for (const [slot, bone] of Object.entries(opts.mapping)) {
      if (bone === null || bone === undefined || bone < 0 || bone >= m.bones.length) delete out[slot as HumanSlot];
      else out[slot as HumanSlot] = { bone, confidence: 1, via: 'manual' };
    }
    return out;
  };

  // Mapping by names, orientation, scale, then structure.
  const nameMap = manual(mapByNames(m));
  const o = orient(m, nameMap);
  fixes.push(...o.notes);
  const sc = scaleAndGround(m, opts.height, nameMap.hips?.bone);
  if (Math.abs(sc.scale - 1) > 1e-3) fixes.push(`Scaled ×${sc.scale.toFixed(sc.scale < 1 ? 4 : 2)} to ${opts.height} units tall, feet on the ground.`);
  const map = manual(completeByStructure(nameMap, m.bones, opts.height));
  const mapping = assess(map);
  const humanoid = mapping.humanoid && !opts.forceStatic;
  if (!humanoid) warnings.push('This doesn’t look like a humanoid: it converts as a static / partially rigged model and won’t follow MMD dances.');

  // Pose.
  const rest = detectRestPose(m, map);
  let armRotation = { left: 0, right: 0 };
  if (humanoid && opts.aPose) {
    armRotation = rebindArms(m, map, opts.armAngle);
    if (armRotation.left || armRotation.right) fixes.push(`Arms re-posed from ${rest.pose} (${rest.angle?.toFixed(0)}°) to the MMD A-pose (${opts.armAngle}°) and the mesh re-skinned.`);
  }

  // Rig.
  const rig = buildRig(m, map, { ...opts.rig, humanoid });

  // Vertices and faces (z flipped, winding reversed).
  const vertices: PmxVertex[] = [];
  const offsets: number[] = [];
  const fallback = rig.index.get('上半身') ?? rig.index.get('センター') ?? 0;
  let unweighted = 0;
  for (const mesh of m.meshes) {
    offsets.push(vertices.length);
    const n = mesh.positions.length / 3;
    for (let v = 0; v < n; v++) {
      const acc = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const w = mesh.weights[v * 4 + k];
        if (!(w > 0)) continue;
        const b = rig.remap[mesh.joints[v * 4 + k]] ?? fallback;
        acc.set(b, (acc.get(b) ?? 0) + w);
      }
      let inf = [...acc.entries()].filter(([, w]) => w > 1e-3).sort((a, b) => b[1] - a[1]).slice(0, 4);
      if (!inf.length) {
        inf = [[fallback, 1]];
        unweighted++;
      }
      const sum = inf.reduce((s, [, w]) => s + w, 0);
      vertices.push({
        position: flip([mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]),
        normal: flip([mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]]),
        uv: [mesh.uvs[v * 2] ?? 0, mesh.uvs[v * 2 + 1] ?? 0],
        bones: inf.map(([b]) => b),
        weights: inf.map(([, w]) => w / sum),
        edgeScale: 1,
      });
    }
  }
  if (unweighted) warnings.push(`${unweighted} vertices had no skin weights; they follow 上半身.`);

  // Materials in source order, faces grouped per material; only used textures are written.
  const indices: number[] = [];
  const materials: PmxMaterial[] = [];
  const usedTex = new Map<number, number>();
  const allPaths = texturePaths(m.textures);
  const textures: { path: string; source: number }[] = [];
  m.materials.forEach((mat, mi) => {
    const start = indices.length;
    m.meshes.forEach((mesh, k) => {
      if (mesh.material !== mi) return;
      const off = offsets[k];
      for (let t = 0; t + 2 < mesh.indices.length; t += 3) indices.push(mesh.indices[t] + off, mesh.indices[t + 2] + off, mesh.indices[t + 1] + off);
    });
    const count = indices.length - start;
    if (!count) return;
    let tex = -1;
    if (mat.texture >= 0) {
      if (!usedTex.has(mat.texture)) {
        usedTex.set(mat.texture, textures.length);
        textures.push({ path: allPaths[mat.texture], source: mat.texture });
      }
      tex = usedTex.get(mat.texture)!;
    }
    let name = mat.name || `material${mi}`;
    while (materials.some((x) => x.name === name)) name = `${name}_`;
    materials.push(toPmxMaterial({ ...mat, texture: tex }, count, name));
  });

  // Morphs.
  const morphPlan = planMorphs(m);
  for (const e of morphPlan.entries) {
    const edit = opts.morphEdits[e.sources[0]?.key ?? e.target];
    if (edit?.enabled !== undefined) e.enabled = edit.enabled;
    if (edit?.target) e.target = edit.target;
  }
  const refByKey = new Map(morphPlan.morphs.map((r) => [r.key, r]));
  const morphs: PmxMorph[] = [];
  const morphIndex = new Map<string, number>();
  const nameTaken = (n: string): boolean => morphs.some((x) => x.name === n);
  const vertexMorph = (key: string, name: string): number => {
    if (morphIndex.has(key)) return morphIndex.get(key)!;
    const ref = refByKey.get(key)!;
    const offs: { vertex: number; offset: V3 }[] = [];
    for (const p of ref.parts) {
      const d = m.meshes[p.mesh].morphs[p.morph].deltas;
      for (let v = 0; v < d.length / 3; v++) {
        const x = d[v * 3];
        const y = d[v * 3 + 1];
        const z = d[v * 3 + 2];
        if (Math.abs(x) + Math.abs(y) + Math.abs(z) > 1e-6) offs.push({ vertex: offsets[p.mesh] + v, offset: [x, y, -z] });
      }
    }
    let n = name;
    for (let i = 2; nameTaken(n); i++) n = `${name}${i}`;
    morphs.push({ kind: 'vertex', name: n, nameEn: ref.name, panel: panelFor(n), offsets: offs });
    morphIndex.set(key, morphs.length - 1);
    return morphs.length - 1;
  };
  const groups: { name: string; sources: { key: string; weight: number }[] }[] = [];
  for (const e of morphPlan.entries) {
    if (!e.enabled) continue;
    if (e.sources.length === 1 && Math.abs(e.sources[0].weight - 1) < 1e-3 && !morphIndex.has(e.sources[0].key)) vertexMorph(e.sources[0].key, e.target);
    else groups.push({ name: e.target, sources: e.sources });
  }
  for (const g of groups) {
    const offsets2 = g.sources.map((s) => ({ morph: vertexMorph(s.key, refByKey.get(s.key)!.name), weight: s.weight }));
    if (!nameTaken(g.name)) morphs.push({ kind: 'group', name: g.name, nameEn: g.name, panel: panelFor(g.name), offsets: offsets2 });
  }

  // Bones into PMX space.
  const bones: PmxBone[] = rig.bones.map((b) => ({
    ...b,
    position: flip(b.position),
    tail: typeof b.tail === 'number' ? b.tail : flip(b.tail),
    ...(b.fixedAxis ? { fixedAxis: flip(b.fixedAxis) } : {}),
    ...(b.localAxis ? { localAxis: { x: flip(b.localAxis.x), z: flip(b.localAxis.z) } } : {}),
  }));

  // Physics chains: VRM spring bones first, then detected chains among the remaining extras.
  let chains: PhysicsChain[] = [];
  const covered = new Set<number>();
  if (m.springs?.chains.length) {
    for (const [ci, c] of m.springs.chains.entries()) {
      const list: number[] = [];
      for (const j of c.joints) {
        const b = rig.remap[j.bone];
        if (b === undefined || b < 0 || list.includes(b) || !rig.extras.includes(b)) continue;
        list.push(b);
      }
      if (!list.length) continue;
      list.forEach((b) => covered.add(b));
      const kind = classify(bones[list[0]].name) ?? classify(c.name) ?? 'hair';
      const j0 = c.joints[0];
      chains.push({
        id: `v${ci}`,
        name: bones[list[0]].name,
        kind,
        preset: presetFor(kind),
        bones: list,
        source: 'vrm',
        enabled: true,
        vrm: { radius: j0.radius, stiffness: j0.stiffness, drag: j0.drag, gravity: j0.gravity },
      });
    }
  }
  chains.push(...detectChains(bones, rig.extras.filter((b) => !covered.has(b))));
  if (!humanoid) chains = chains.filter((c) => c.source !== 'structure');
  for (const c of chains) {
    const e = opts.chainEdits[c.id];
    if (e?.enabled !== undefined) c.enabled = e.enabled;
    if (e?.preset) c.preset = e.preset;
  }
  const phys = buildPhysics(bones, chains, opts.physics, opts.height);

  // Display frames.
  const frames = displayFrames(bones, morphs, chains, rig.extras);

  const pmx: PmxModel = {
    name: opts.name ?? m.name,
    nameEn: opts.name ?? m.name,
    comment: `Converted by MMD Studio from ${src.format.toUpperCase()}. Source: ${src.name}.${src.license?.author ? ` Author: ${src.license.author}.` : ''}`,
    commentEn: `Converted by MMD Studio from ${src.format.toUpperCase()}.`,
    vertices,
    indices: Uint32Array.from(indices),
    textures: textures.map((t) => t.path),
    materials,
    bones,
    morphs,
    frames,
    rigidBodies: phys.rigidBodies,
    joints: phys.joints,
  };
  const validation = validatePmx(pmx);
  for (const v of validation) (v.level === 'error' ? warnings : warnings).push(v.message);

  const tips: string[] = [];
  if (mapping.weak.length) tips.push('Some body bones were guessed: check the mapping step before converting.');
  if (vertices.length > 150_000) tips.push('High polygon count: MMD tools may be slow; consider decimating the model first.');
  if (!morphPlan.morphs.length) tips.push('No face morphs: blinking and talking clips won’t change the face.');
  if (!morphs.some((x) => x.name === 'まばたき')) tips.push('No blink morph found: map one in the Face step to use blink clips.');
  if (humanoid && !chains.length) tips.push('No hair or skirt bones were found, so nothing sways.');
  const triangles = src.meshes.reduce((s, x) => s + x.indices.length / 3, 0);
  const report: ConversionReport = {
    source: {
      name: src.name,
      format: src.format,
      bones: src.bones.length,
      vertices: src.meshes.reduce((s, x) => s + x.positions.length / 3, 0),
      triangles,
      materials: src.materials.length,
      morphs: morphPlan.morphs.length,
    },
    output: { bones: bones.length, vertices: vertices.length, materials: materials.length, morphs: morphs.length, rigidBodies: phys.rigidBodies.length, joints: phys.joints.length },
    humanoid,
    restPose: rest.pose,
    armAngle: rest.angle,
    armRotation,
    scale: sc.scale,
    mapping: Object.entries(map).map(([slot, s]) => ({ slot: slot as HumanSlot, bone: m.bones[s!.bone].name, confidence: s!.confidence, via: s!.via })),
    weakSlots: mapping.weak,
    unmappedBones: rig.extras.map((i) => bones[i].name),
    fixes,
    warnings,
    tips,
  };
  return { pmx, textures, map, mapping, morphPlan, chains, validation, report, model: m };
}

function displayFrames(bones: PmxBone[], morphs: PmxMorph[], chains: PhysicsChain[], extras: number[]): PmxDisplayFrame[] {
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  const placed = new Set<number>([byName.get('全ての親') ?? 0]);
  const frame = (name: string, nameEn: string, test: (b: PmxBone, i: number) => boolean): PmxDisplayFrame => {
    const items: PmxDisplayFrame['items'] = [];
    bones.forEach((b, i) => {
      if (placed.has(i) || !test(b, i)) return;
      placed.add(i);
      items.push({ kind: 'bone', index: i });
    });
    return { name, nameEn, special: false, items };
  };
  const physicsBones = new Set(chains.flatMap((c) => c.bones));
  const out: PmxDisplayFrame[] = [
    { name: 'Root', nameEn: 'Root', special: true, items: [{ kind: 'bone', index: byName.get('全ての親') ?? 0 }] },
    { name: '表情', nameEn: 'Exp', special: true, items: morphs.map((_, i) => ({ kind: 'morph' as const, index: i })) },
    frame('センター', 'Center', (b) => /^(センター|グルーブ)$/.test(b.name)),
    frame('ＩＫ', 'IK', (b) => /ＩＫ|IK親/.test(b.name)),
    frame('体(上)', 'Body', (b) => /^(上半身\d?|首|頭|両目|左目|右目|あご|腰|下半身)$/.test(b.name)),
    frame('腕', 'Arms', (b) => /^[左右](肩P?|肩C|腕|腕捩|ひじ|手捩|手首)$/.test(b.name)),
    frame('指', 'Fingers', (b) => /^[左右](親指|人指|中指|薬指|小指)/.test(b.name)),
    frame('足', 'Legs', (b) => /^[左右](足|ひざ|足首|つま先)D?$|^[左右](足D|ひざD|足首D)$/.test(b.name)),
    frame('物理', 'Physics', (_, i) => physicsBones.has(i)),
    frame('その他', 'Other', (_, i) => extras.includes(i) || i > 0),
  ];
  return out.filter((f) => f.special || f.items.length);
}
