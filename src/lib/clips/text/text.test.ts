import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'opentype.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { extrudeShapes, flatten, signedArea, toShapes, type MeshData, type Pt } from './geometry';
import { clearGlyphCache, glyphCacheSize, layoutText, type LayoutOptions } from './layout';
import { fontResolver, type NamedFont } from './resolver';
import { textAnimState } from './anim';

const fontDir = join(__dirname, '../../../../public/fonts');
const load = (file: string, id: string): NamedFont => {
  const b = readFileSync(join(fontDir, file));
  return { id, font: parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) };
};

/** Closed-mesh signed volume (divergence theorem): positive when every face points outward. */
function volume(m: MeshData): number {
  let v = 0;
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
    v +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  return v;
}

/** Fraction of triangles whose face normal agrees with their vertex normals. */
function normalAgreement(m: MeshData): number {
  const p = m.positions;
  const n = m.normals;
  let ok = 0;
  let total = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const w = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (Math.hypot(f[0], f[1], f[2]) < 1e-12) continue;
    total++;
    const vn = [n[a] + n[b] + n[c], n[a + 1] + n[b + 1] + n[c + 1], n[a + 2] + n[b + 2] + n[c + 2]];
    if (f[0] * vn[0] + f[1] * vn[1] + f[2] * vn[2] > 0) ok++;
  }
  return ok / Math.max(1, total);
}

const square = (x: number, y: number, s: number, ccw = true): Pt[] => {
  const q: Pt[] = [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ];
  return ccw ? q : q.reverse();
};

describe('extrusion', () => {
  it('extrudes a square into a closed, outward-facing box', () => {
    const m = extrudeShapes(toShapes([square(0, 0, 1)]), { depth: 0.5, bevel: 0, bevelSegments: 0, curveSegments: 1 });
    expect(volume(m)).toBeCloseTo(0.5, 6);
    expect(normalAgreement(m)).toBe(1);
  });

  it('cuts holes whatever the input winding (TrueType or CFF)', () => {
    for (const ccw of [true, false]) {
      const shapes = toShapes([square(0, 0, 3, ccw), square(1, 1, 1, ccw)]);
      expect(shapes).toHaveLength(1);
      expect(shapes[0].holes).toHaveLength(1);
      expect(signedArea(shapes[0].outer)).toBeGreaterThan(0);
      expect(signedArea(shapes[0].holes[0])).toBeLessThan(0);
      const m = extrudeShapes(shapes, { depth: 1, bevel: 0, bevelSegments: 0, curveSegments: 1 });
      expect(volume(m)).toBeCloseTo(8, 6);
      expect(normalAgreement(m)).toBe(1);
    }
  });

  it('bevels outward and stays closed', () => {
    const m = extrudeShapes(toShapes([square(0, 0, 1)]), { depth: 0.5, bevel: 0.05, bevelSegments: 3, curveSegments: 1 });
    expect(volume(m)).toBeGreaterThan(0.5);
    expect(normalAgreement(m)).toBeGreaterThan(0.99);
  });

  it('flattens curves', () => {
    const c = flatten(
      [
        { type: 'M', x: 0, y: 0 },
        { type: 'Q', x1: 1, y1: 2, x: 2, y: 0 },
        { type: 'Z' },
      ],
      8,
    );
    expect(c).toHaveLength(1);
    expect(c[0].length).toBe(9);
  });
});

describe('text layout with real fonts', () => {
  let noto: NamedFont;
  let bungee: NamedFont;
  beforeAll(() => {
    noto = load('NotoSansJP-Bold.otf', 'noto');
    bungee = load('Bungee-Regular.ttf', 'bungee');
  });
  const opts: LayoutOptions = { size: 1, letterSpacing: 0, lineSpacing: 1.2, align: 'center', depth: 0.2, bevel: 0.02, quality: 'medium' };

  it('builds non-empty, closed geometry for Latin, kana, kanji, digits and symbols', () => {
    for (const s of ['Hello', 'こんにちは', 'カタカナ', '漢字', '0123456789', '!?&@#%']) {
      const m = layoutText(s, fontResolver(noto, []), opts);
      expect(m.missing).toEqual([]);
      expect(m.glyphs.length).toBe(Array.from(s).length);
      expect(m.indices.length).toBeGreaterThan(0);
      expect(volume(m)).toBeGreaterThan(0);
      expect(normalAgreement(m)).toBe(1);
    }
  });

  it('falls back to Noto for Japanese in a Latin display font and reports missing glyphs', () => {
    const r = fontResolver(bungee, [noto]);
    const m = layoutText('Hi こんにちは', r, opts);
    expect(m.missing).toEqual([]);
    expect(m.glyphs.map((g) => g.char).join('')).toBe('Hiこんにちは');
    const alone = layoutText('Hi こ', fontResolver(bungee, []), opts);
    expect(alone.missing).toEqual(['こ']);
  });

  it('centers multi-line blocks and aligns lines', () => {
    const m = layoutText('Hello\nこんにちは', fontResolver(noto, []), opts);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      minX = Math.min(minX, m.positions[i]);
      maxX = Math.max(maxX, m.positions[i]);
      minY = Math.min(minY, m.positions[i + 1]);
      maxY = Math.max(maxY, m.positions[i + 1]);
    }
    expect(Math.abs(minX + maxX)).toBeLessThan(0.2);
    expect(Math.abs(minY + maxY)).toBeLessThan(0.3);
    expect(new Set(m.glyphs.map((g) => g.line))).toEqual(new Set([0, 1]));
    const left = layoutText('Hi\nHello', fontResolver(noto, []), { ...opts, align: 'left' });
    const firstOf = (line: number) => left.glyphs.find((g) => g.line === line)!.center[0];
    expect(firstOf(0)).toBeCloseTo(firstOf(1), 1);
  });

  it('caches glyph meshes', () => {
    clearGlyphCache();
    layoutText('ああああ', fontResolver(noto, []), opts);
    expect(glyphCacheSize()).toBe(1);
    layoutText('ああ', fontResolver(noto, []), { ...opts, quality: 'low' });
    expect(glyphCacheSize()).toBe(2);
  });
});

describe('text animation timing', () => {
  const base = { animIn: 'none', animInFrames: 10, animOut: 'none', animOutFrames: 10, idle: 'none' } as const;
  it('is invisible outside the clip and at rest in the middle', () => {
    expect(textAnimState(base, -1, 100, 5).visible).toBe(false);
    expect(textAnimState(base, 100, 100, 5).visible).toBe(false);
    const s = textAnimState({ ...base, animIn: 'pop', animOut: 'fade' }, 50, 100, 5);
    expect(s).toMatchObject({ visible: true, opacity: 1, scale: 1, reveal: 5, letters: null });
  });
  it('fades in and out', () => {
    const f = { ...base, animIn: 'fade', animOut: 'fade' } as const;
    expect(textAnimState(f, 0, 100, 5).opacity).toBe(0);
    expect(textAnimState(f, 5, 100, 5).opacity).toBeCloseTo(0.5);
    expect(textAnimState(f, 95, 100, 5).opacity).toBeCloseTo(0.5);
  });
  it('types letters one by one', () => {
    const tw = { ...base, animIn: 'typewriter', animInFrames: 10 } as const;
    expect(textAnimState(tw, 0, 100, 5).reveal).toBe(0);
    expect(textAnimState(tw, 4, 100, 5).reveal).toBe(2);
    expect(textAnimState(tw, 10, 100, 5).reveal).toBe(5);
  });
  it('waves letters in order and settles', () => {
    const w = { ...base, animIn: 'wave', animInFrames: 20 } as const;
    const mid = textAnimState(w, 6, 100, 5).letters!;
    expect(mid[0].scale).toBeGreaterThan(mid[4].scale);
    expect(textAnimState(w, 20, 100, 5).letters).toBeNull();
  });
  it('drops in with a bounce and idles', () => {
    const d = textAnimState({ ...base, animIn: 'drop' }, 0, 100, 1);
    expect(d.offset[1]).toBeGreaterThan(3);
    const fl = [0, 22, 45].map((f) => textAnimState({ ...base, idle: 'float' }, f, 100, 1).offset[1]);
    expect(fl[1]).toBeGreaterThan(fl[0]);
    expect(Math.abs(fl[2])).toBeLessThan(0.01);
  });
  it('shares a short clip between in and out', () => {
    const s = textAnimState({ ...base, animIn: 'fade', animInFrames: 30, animOut: 'fade', animOutFrames: 30 }, 5, 10, 1);
    expect(s.opacity).toBeCloseTo(1);
  });
});
