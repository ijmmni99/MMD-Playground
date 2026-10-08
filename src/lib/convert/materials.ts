// Source materials → PMX materials (an approximation of the original shader; MToon colours mapped to
// diffuse / ambient / edge) and texture file names.

import { MaterialFlag, type PmxMaterial } from './pmx/types';
import type { SourceMaterial, SourceTexture } from './types';

/** Safe, unique ASCII file names under `tex/`. */
export function texturePaths(textures: SourceTexture[]): string[] {
  const used = new Set<string>();
  return textures.map((t, i) => {
    const ext = /jpe?g/i.test(t.mime) ? 'jpg' : /tga/i.test(t.mime) ? 'tga' : /bmp/i.test(t.mime) ? 'bmp' : 'png';
    let base = t.name
      .replace(/\.[^.]+$/, '')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (!base) base = `tex${i}`;
    let name = `${base}.${ext}`;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base}_${k}.${ext}`;
    used.add(name.toLowerCase());
    return `tex/${name}`;
  });
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function toPmxMaterial(m: SourceMaterial, indexCount: number, name?: string): PmxMaterial {
  const [r, g, b, a] = m.color;
  const alpha = m.alphaMode === 'blend' ? clamp01(a) : 1;
  // Ambient: MMD adds it to the lit diffuse; MToon's shade colour gives the dark side.
  const shade = m.mtoon?.shade ?? [r * 0.6, g * 0.6, b * 0.6];
  const ambient: [number, number, number] = [
    clamp01(shade[0] * 0.5 + m.emissive[0]),
    clamp01(shade[1] * 0.5 + m.emissive[1]),
    clamp01(shade[2] * 0.5 + m.emissive[2]),
  ];
  const outline = m.mtoon ? m.mtoon.outlineWidth > 0 : m.alphaMode !== 'blend';
  let flags = MaterialFlag.GroundShadow | MaterialFlag.DrawShadow | MaterialFlag.ReceiveShadow;
  if (m.doubleSided || m.alphaMode !== 'opaque') flags |= MaterialFlag.DoubleSided;
  if (outline) flags |= MaterialFlag.Edge;
  if (m.alphaMode === 'blend') flags &= ~MaterialFlag.DrawShadow;
  const width = m.mtoon?.outlineWidth ?? 0;
  return {
    name: name ?? m.name,
    nameEn: m.name,
    diffuse: [clamp01(r * (m.unlit ? 0.8 : 1)), clamp01(g * (m.unlit ? 0.8 : 1)), clamp01(b * (m.unlit ? 0.8 : 1)), alpha],
    specular: [0.1, 0.1, 0.1],
    shininess: 5,
    ambient,
    flags,
    edgeColor: [...(m.mtoon?.outlineColor ?? [0, 0, 0]), 1] as [number, number, number, number],
    // VRM outline width is in metres (≈ 0.001–0.005); PMX edge size ≈ 1 is a normal line.
    edgeSize: width > 0 ? Math.min(2, Math.max(0.3, width * 300)) : 0.6,
    texture: m.texture,
    sphere: -1,
    sphereMode: 0,
    sharedToon: 0,
    memo: m.mtoon ? 'Converted from MToon (approximate)' : '',
    indexCount,
  };
}

/** Material-name families and the texture-name words that go with them. */
const FAMILIES: [RegExp, RegExp][] = [
  [/髪|hair|おさげ|ポニテ|ツインテ|bang|fringe|ponytail|ahoge/i, /hair|髪/i],
  [/顔|face|目|瞳|eye|iris|口|mouth|歯|teeth|tooth|舌|tongue|まつ|lash|まゆ|眉|brow|頬|cheek|ハイライト|highlight|白目|表情|head/i, /face|顔|eye|head/i],
  [/体|肌|skin|body|服|cloth|shirt|skirt|スカート|帽子|hat|hood|靴|shoe|boot|手|hand|足|leg|ex/i, /body|体|cloth|skin|outfit|main/i],
];

/**
 * Give untextured materials a texture from the loose images in the upload (Sketchfab-style exports keep
 * textures beside the model without linking them). Returns `material → texture` assignments.
 */
export function autoAssignTextures(materials: SourceMaterial[], textures: SourceTexture[]): Map<number, number> {
  const out = new Map<number, number>();
  const loose = textures.map((t, i) => ({ t, i })).filter((x) => x.t.loose && x.t.data.length);
  if (!loose.length) return out;
  const noneTextured = materials.every((m) => m.texture < 0);
  // Fallback when nothing matches: a "body / main / base / diffuse" image, else the largest.
  const fallback =
    loose.find((x) => /body|main|base|diffuse|albedo|color|colour|tex/i.test(x.t.name)) ??
    [...loose].sort((a, b) => b.t.data.length - a.t.data.length)[0];
  materials.forEach((m, mi) => {
    if (m.texture >= 0) return;
    let pick: number | undefined;
    // 1. The texture name contains the material name (or vice versa).
    const mn = m.name.toLowerCase().replace(/[_\s.-]+/g, '');
    const direct = loose.find((x) => {
      const tn = x.t.name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[_\s.-]+/g, '');
      return tn.length >= 2 && mn.length >= 2 && (tn.includes(mn) || mn.includes(tn));
    });
    if (direct) pick = direct.i;
    // 2. Same family (hair / face / body).
    if (pick === undefined)
      for (const [matRe, texRe] of FAMILIES)
        if (matRe.test(m.name)) {
          const hit = loose.find((x) => texRe.test(x.t.name));
          if (hit) {
            pick = hit.i;
            break;
          }
        }
    // 3. Fallback only when the model has no texture links at all.
    if (pick === undefined && noneTextured && !/outline/i.test(m.name)) pick = fallback.i;
    if (pick !== undefined) out.set(mi, pick);
  });
  return out;
}
