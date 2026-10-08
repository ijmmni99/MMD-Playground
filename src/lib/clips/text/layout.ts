// Text layout: lines of glyphs (with font fallback per character) → one merged mesh per text clip,
// centered on the origin, plus per-glyph ranges for letter animations. Glyph meshes are cached.

import { glyphMesh, mergeMeshes, type MeshData, type PathCommand } from './geometry';

/** One glyph from a font (or a fallback font). */
export interface ResolvedGlyph {
  /** Unique per font + glyph (cache key). */
  key: string;
  /** Advance width in em. */
  advance: number;
  unitsPerEm: number;
  /** Outline in font units (y up). */
  commands: () => PathCommand[];
}

/** Character → glyph; null when no font has it. */
export type GlyphResolver = (ch: string) => ResolvedGlyph | null;

export type TextQuality = 'low' | 'medium' | 'high';

export const QUALITY: Record<TextQuality, { curveSegments: number; bevelSegments: number }> = {
  low: { curveSegments: 2, bevelSegments: 1 },
  medium: { curveSegments: 5, bevelSegments: 2 },
  high: { curveSegments: 9, bevelSegments: 4 },
};

export interface LayoutOptions {
  /** Em size in world units. */
  size: number;
  /** Extra space between letters (em). */
  letterSpacing: number;
  /** Line height (em). */
  lineSpacing: number;
  align: 'left' | 'center' | 'right';
  /** World units. */
  depth: number;
  bevel: number;
  quality: TextQuality;
}

export interface GlyphRange {
  char: string;
  /** Index among visible glyphs. */
  index: number;
  line: number;
  indexStart: number;
  indexCount: number;
  vertexStart: number;
  vertexCount: number;
  /** Glyph center (world units, after centering). */
  center: [number, number];
}

export interface TextMesh extends MeshData {
  glyphs: GlyphRange[];
  /** Characters no font could draw. */
  missing: string[];
  width: number;
  height: number;
}

const MAX_CACHE = 3000;
const cache = new Map<string, MeshData>();

export function clearGlyphCache(): void {
  cache.clear();
}
export const glyphCacheSize = (): number => cache.size;

function cachedGlyph(g: ResolvedGlyph, depthEm: number, bevelEm: number, q: TextQuality): MeshData {
  const key = `${g.key}|${q}|${depthEm.toFixed(4)}|${bevelEm.toFixed(4)}`;
  let m = cache.get(key);
  if (m) {
    // LRU: most recent last.
    cache.delete(key);
    cache.set(key, m);
    return m;
  }
  m = glyphMesh(g.commands(), g.unitsPerEm, { depth: depthEm, bevel: bevelEm, ...QUALITY[q] });
  cache.set(key, m);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return m;
}

const isSpace = (ch: string): boolean => /\s/.test(ch);

export function layoutText(content: string, resolve: GlyphResolver, o: LayoutOptions): TextMesh {
  const size = Math.max(1e-3, o.size);
  const depthEm = Math.max(0.001, o.depth / size);
  // Big bevels make neighbouring letters fuse.
  const bevelEm = Math.min(0.06, Math.max(0, o.bevel / size));
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const missing = new Set<string>();
  type Placed = { ch: string; mesh: MeshData; x: number; line: number; advance: number };
  const placed: Placed[] = [];
  const widths: number[] = [];
  lines.forEach((line, li) => {
    let x = 0;
    for (const ch of Array.from(line)) {
      const g = resolve(ch);
      if (!g) {
        if (!isSpace(ch)) missing.add(ch);
        x += (ch === '\t' ? 1.2 : 0.3) + o.letterSpacing;
        continue;
      }
      if (!isSpace(ch)) placed.push({ ch, mesh: cachedGlyph(g, depthEm, bevelEm, o.quality), x, line: li, advance: g.advance });
      x += g.advance + o.letterSpacing;
    }
    widths.push(Math.max(0, x - (line.length ? o.letterSpacing : 0)));
  });
  const blockW = Math.max(0, ...widths);
  const lineH = o.lineSpacing;
  // Baselines go down; the block is centered on (0, 0). Glyphs sit roughly in [-0.12, 0.88] em.
  const top = 0.88;
  const blockH = (lines.length - 1) * lineH + 1;
  const parts: { mesh: MeshData; scale: number; dx: number; dy: number }[] = [];
  const glyphs: GlyphRange[] = [];
  let vs = 0;
  let is = 0;
  for (const p of placed) {
    const lw = widths[p.line];
    const alignX = o.align === 'left' ? -blockW / 2 : o.align === 'right' ? blockW / 2 - lw : -lw / 2;
    const dx = (alignX + p.x) * size;
    const dy = (blockH / 2 - top - p.line * lineH) * size;
    parts.push({ mesh: p.mesh, scale: size, dx, dy });
    const vc = p.mesh.positions.length / 3;
    const ic = p.mesh.indices.length;
    glyphs.push({
      char: p.ch,
      index: glyphs.length,
      line: p.line,
      indexStart: is,
      indexCount: ic,
      vertexStart: vs,
      vertexCount: vc,
      center: [dx + (p.advance / 2) * size, dy + 0.38 * size],
    });
    vs += vc;
    is += ic;
  }
  const merged = mergeMeshes(parts);
  return { ...merged, glyphs, missing: [...missing], width: blockW * size, height: blockH * size };
}
