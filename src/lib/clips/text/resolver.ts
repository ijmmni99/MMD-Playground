// Glyph lookup across a primary font and fallbacks (opentype.js fonts).

import type { Font } from 'opentype.js';
import type { PathCommand } from './geometry';
import type { GlyphResolver, ResolvedGlyph } from './layout';

export interface NamedFont {
  /** Stable id (family name / user font id) for the glyph cache. */
  id: string;
  font: Font;
}

/** Resolve characters in `primary`, then each fallback in order (glyph 0 = .notdef = missing). */
export function fontResolver(primary: NamedFont | null, fallbacks: readonly NamedFont[]): GlyphResolver {
  const fonts = [primary, ...fallbacks].filter((f): f is NamedFont => !!f);
  const memo = new Map<string, ResolvedGlyph | null>();
  return (ch) => {
    if (memo.has(ch)) return memo.get(ch)!;
    let out: ResolvedGlyph | null = null;
    for (const { id, font } of fonts) {
      const gi = font.charToGlyphIndex(ch);
      if (!gi) continue;
      const glyph = font.glyphs.get(gi);
      const upm = font.unitsPerEm || 1000;
      out = {
        key: `${id}#${gi}`,
        advance: (glyph.advanceWidth ?? upm * 0.6) / upm,
        unitsPerEm: upm,
        commands: () => (glyph.path?.commands ?? []) as PathCommand[],
      };
      break;
    }
    memo.set(ch, out);
    return out;
  };
}
