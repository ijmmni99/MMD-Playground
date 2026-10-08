// Source materials → PMX materials (an approximation of the original shader; MToon colours mapped to
// diffuse / ambient / edge) and texture file names.

import { MaterialFlag, type PmxMaterial } from './pmx/types';
import type { SourceMaterial, SourceTexture } from './types';

/** Safe, unique ASCII file names under `tex/`. */
export function texturePaths(textures: SourceTexture[]): string[] {
  const used = new Set<string>();
  return textures.map((t, i) => {
    const ext = /jpe?g/i.test(t.mime) ? 'jpg' : 'png';
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
