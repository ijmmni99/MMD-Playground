// Procedural test model for the Model Editor (original content, no copyrighted assets): a ~20-unit humanoid
// with standard MMD bone names, weighted limb tubes that blend across joints, hands with fingers, leg IK,
// arm twist helpers, a skirt chain with physics, outfit materials (hair, face, body, top, skirt, shoes,
// gloves, accessory), vertex / group / bone / material morphs and display frames.

import { buildPhysics, detectChains, DEFAULT_PHYSICS } from '@/lib/convert/physics';
import {
  BoneFlag,
  MaterialFlag,
  type PmxBone,
  type PmxMaterial,
  type PmxModel,
  type PmxMorph,
  type PmxVertex,
  type V3,
} from '@/lib/convert/pmx/types';

const R = BoneFlag.Rotatable | BoneFlag.Visible | BoneFlag.Enabled;
const RM = R | BoneFlag.Movable;

interface BoneSpec {
  name: string;
  nameEn: string;
  parent: string | null;
  pos: V3;
  flags?: number;
}

function boneSpecs(): BoneSpec[] {
  const b: BoneSpec[] = [
    { name: '全ての親', nameEn: 'motherbone', parent: null, pos: [0, 0, 0], flags: RM },
    { name: 'センター', nameEn: 'center', parent: '全ての親', pos: [0, 8, 0], flags: RM },
    { name: '下半身', nameEn: 'lower body', parent: 'センター', pos: [0, 10.5, 0] },
    { name: '上半身', nameEn: 'upper body', parent: 'センター', pos: [0, 10.5, 0] },
    { name: '上半身2', nameEn: 'upper body2', parent: '上半身', pos: [0, 12, 0] },
    { name: '首', nameEn: 'neck', parent: '上半身2', pos: [0, 14.6, 0] },
    { name: '頭', nameEn: 'head', parent: '首', pos: [0, 15.4, 0] },
  ];
  for (const [J, E, s] of [
    ['左', 'left', 1],
    ['右', 'right', -1],
  ] as const) {
    const x = (v: number): number => v * s;
    b.push(
      { name: `${J}肩`, nameEn: `shoulder_${E[0].toUpperCase()}`, parent: '上半身2', pos: [x(0.4), 14.2, 0] },
      { name: `${J}腕`, nameEn: `arm_${E[0].toUpperCase()}`, parent: `${J}肩`, pos: [x(1.6), 14, 0] },
      {
        name: `${J}腕捩`,
        nameEn: `arm twist_${E[0].toUpperCase()}`,
        parent: `${J}腕`,
        pos: [x(2.9), 14, 0],
        flags: R | BoneFlag.FixedAxis,
      },
      { name: `${J}ひじ`, nameEn: `elbow_${E[0].toUpperCase()}`, parent: `${J}腕`, pos: [x(4.2), 14, 0] },
      { name: `${J}手首`, nameEn: `wrist_${E[0].toUpperCase()}`, parent: `${J}ひじ`, pos: [x(6.6), 14, 0] },
      {
        name: `${J}親指１`,
        nameEn: `thumb1_${E[0].toUpperCase()}`,
        parent: `${J}手首`,
        pos: [x(7), 14, -0.35],
      },
      {
        name: `${J}親指２`,
        nameEn: `thumb2_${E[0].toUpperCase()}`,
        parent: `${J}親指１`,
        pos: [x(7.4), 14, -0.55],
      },
    );
    for (const [f, fe, z] of [
      ['人指', 'fore', -0.2],
      ['中指', 'middle', 0],
      ['薬指', 'third', 0.2],
    ] as const) {
      b.push(
        {
          name: `${J}${f}１`,
          nameEn: `${fe}1_${E[0].toUpperCase()}`,
          parent: `${J}手首`,
          pos: [x(7.5), 14, z],
        },
        {
          name: `${J}${f}２`,
          nameEn: `${fe}2_${E[0].toUpperCase()}`,
          parent: `${J}${f}１`,
          pos: [x(7.9), 14, z],
        },
        {
          name: `${J}${f}３`,
          nameEn: `${fe}3_${E[0].toUpperCase()}`,
          parent: `${J}${f}２`,
          pos: [x(8.2), 14, z],
        },
      );
    }
    b.push(
      { name: `${J}足`, nameEn: `leg_${E[0].toUpperCase()}`, parent: '下半身', pos: [x(0.9), 10, 0] },
      { name: `${J}ひざ`, nameEn: `knee_${E[0].toUpperCase()}`, parent: `${J}足`, pos: [x(0.9), 5.6, 0] },
      { name: `${J}足首`, nameEn: `ankle_${E[0].toUpperCase()}`, parent: `${J}ひざ`, pos: [x(0.9), 1.1, 0] },
      {
        name: `${J}つま先`,
        nameEn: `toe_${E[0].toUpperCase()}`,
        parent: `${J}足首`,
        pos: [x(0.9), 0.1, -1.4],
      },
      {
        name: `${J}足ＩＫ`,
        nameEn: `leg IK_${E[0].toUpperCase()}`,
        parent: '全ての親',
        pos: [x(0.9), 1.1, 0],
        flags: RM,
      },
      {
        name: `${J}つま先ＩＫ`,
        nameEn: `toe IK_${E[0].toUpperCase()}`,
        parent: `${J}足ＩＫ`,
        pos: [x(0.9), 0.1, -1.4],
        flags: RM,
      },
    );
  }
  // Skirt chains (front, back, left, right), hanging off 下半身.
  for (const [d, dx, dz] of [
    ['前', 0, -1],
    ['後', 0, 1],
    ['左', 1, 0],
    ['右', -1, 0],
  ] as const) {
    for (let k = 1; k <= 3; k++) {
      const r = 1.6 + k * 0.45;
      b.push({
        name: `スカート${d}${k}`,
        nameEn: `skirt_${d === '前' ? 'F' : d === '後' ? 'B' : d === '左' ? 'L' : 'R'}${k}`,
        parent: k === 1 ? '下半身' : `スカート${d}${k - 1}`,
        pos: [dx * r, 10.4 - k * 1.3, dz * r],
      });
    }
  }
  return b;
}

// ------------------------------------------------------------------ geometry

interface Builder {
  vertices: PmxVertex[];
  /** Faces per material, in material order. */
  faces: number[][];
}

type Weights = [number[], number[]];

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Orthonormal basis around axis `d`. */
function basis(d: V3): [V3, V3] {
  const a: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm([d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]]);
  const v: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  return [u, v];
}

/**
 * Tube from `a` to `b` (rings × sides, capped), radius per ring, weights per ring. Rings share the same
 * weights around the circumference.
 */
function tube(
  g: Builder,
  mat: number,
  a: V3,
  b: V3,
  radius: (t: number) => number,
  weights: (t: number) => Weights,
  rings = 6,
  sides = 8,
): void {
  const d = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const [u, v] = basis(d);
  const start = g.vertices.length;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const c: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const rad = radius(t);
    const [bones, w] = weights(t);
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      const n: V3 = [
        u[0] * Math.cos(ang) + v[0] * Math.sin(ang),
        u[1] * Math.cos(ang) + v[1] * Math.sin(ang),
        u[2] * Math.cos(ang) + v[2] * Math.sin(ang),
      ];
      g.vertices.push({
        position: [c[0] + n[0] * rad, c[1] + n[1] * rad, c[2] + n[2] * rad],
        normal: n,
        uv: [s / sides, t],
        bones: [...bones],
        weights: [...w],
        edgeScale: 1,
      });
    }
  }
  const f = g.faces[mat];
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < sides; s++) {
      const i0 = start + r * sides + s;
      const i1 = start + r * sides + ((s + 1) % sides);
      const j0 = i0 + sides;
      const j1 = i1 + sides;
      f.push(i0, i1, j0, i1, j1, j0);
    }
  // Caps (fan around ring 0 and the last ring).
  for (const [ring, flip] of [
    [0, true],
    [rings, false],
  ] as const) {
    const c = ring === 0 ? a : b;
    const [bones, w] = weights(ring / rings);
    const ci = g.vertices.length;
    g.vertices.push({
      position: [...c],
      normal: ring === 0 ? [-d[0], -d[1], -d[2]] : d,
      uv: [0.5, ring === 0 ? 0 : 1],
      bones: [...bones],
      weights: [...w],
      edgeScale: 1,
    });
    for (let s = 0; s < sides; s++) {
      const p = start + ring * sides + s;
      const q = start + ring * sides + ((s + 1) % sides);
      if (flip) f.push(ci, q, p);
      else f.push(ci, p, q);
    }
  }
}

/** Weights blending from `from` to `to` over the start of the segment (t < blend). */
const blendIn =
  (from: number, to: number, blend = 0.25) =>
  (t: number): Weights =>
    t >= blend || from === to
      ? [[to], [1]]
      : [
          [from, to],
          [0.5 - (t / blend) * 0.5, 0.5 + (t / blend) * 0.5],
        ];

// ------------------------------------------------------------------ PNG (tiny, uncompressed)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array): number => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Solid-colour RGBA PNG with a checker of `b` (stored deflate blocks, no compression library needed). */
export function checkerPng(
  size: number,
  a: [number, number, number],
  b: [number, number, number],
): Uint8Array {
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = ((x >> 2) + (y >> 2)) & 1 ? b : a;
      raw.set([...c, 255], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  // zlib: header + stored blocks + adler32.
  const blocks: number[] = [0x78, 0x01];
  for (let o = 0; o < raw.length; o += 65535) {
    const n = Math.min(65535, raw.length - o);
    blocks.push(o + n >= raw.length ? 1 : 0, n & 0xff, n >> 8, ~n & 0xff, (~n >> 8) & 0xff);
    for (let i = 0; i < n; i++) blocks.push(raw[o + i]);
  }
  let s1 = 1;
  let s2 = 0;
  for (const x of raw) {
    s1 = (s1 + x) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  blocks.push(s2 >> 8, s2 & 0xff, s1 >> 8, s1 & 0xff);
  const chunk = (type: string, data: Uint8Array): number[] => {
    const td = new Uint8Array(4 + data.length);
    td.set([...type].map((ch) => ch.charCodeAt(0)));
    td.set(data, 4);
    const len = data.length;
    const crc = crc32(td);
    return [
      len >>> 24,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
      ...td,
      crc >>> 24,
      (crc >> 16) & 0xff,
      (crc >> 8) & 0xff,
      crc & 0xff,
    ];
  };
  const ihdr = new Uint8Array([0, 0, 0, size, 0, 0, 0, size, 8, 6, 0, 0, 0]);
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', new Uint8Array(blocks)),
    ...chunk('IEND', new Uint8Array(0)),
  ]);
}

// ------------------------------------------------------------------ model

export const FIXTURE_MATERIALS = ['髪', '顔', '体', 'トップス', 'スカート', '靴', '手袋', 'リボン'] as const;
/** Extra materials for the NPR look tests (opts.npr). */
export const NPR_MATERIALS = ['目', 'ニーソ', 'ベルト金具'] as const;
type MatName = (typeof FIXTURE_MATERIALS)[number] | (typeof NPR_MATERIALS)[number];

export interface FixtureOptions {
  /** Model name (Japanese). */
  name?: string;
  nameEn?: string;
  /** Only these materials (for a "clothes donor" model); the skeleton is always complete. */
  materials?: readonly string[];
  /** Tint applied to the top (lets a donor's jacket look different). */
  topColor?: [number, number, number];
  /** Rename the top material (e.g. ジャケット for a donor). */
  topName?: string;
  /** Add eyes, stockings and a metal belt (NPR look tests). */
  npr?: boolean;
}

export interface FixtureFiles {
  pmx: PmxModel;
  /** Texture files (path → PNG bytes). */
  textures: Record<string, Uint8Array>;
}

const matDef = (
  name: string,
  nameEn: string,
  diffuse: [number, number, number],
  texture = -1,
): PmxMaterial => ({
  name,
  nameEn,
  diffuse: [...diffuse, 1],
  specular: [0.1, 0.1, 0.1],
  shininess: 8,
  ambient: [diffuse[0] * 0.5, diffuse[1] * 0.5, diffuse[2] * 0.5],
  flags: MaterialFlag.DrawShadow | MaterialFlag.ReceiveShadow | MaterialFlag.GroundShadow | MaterialFlag.Edge,
  edgeColor: [0.1, 0.1, 0.15, 1],
  edgeSize: 1,
  texture,
  sphere: -1,
  sphereMode: 0,
  sharedToon: 0,
  memo: '',
  indexCount: 0,
});

export function makeEditFixture(opts: FixtureOptions = {}): FixtureFiles {
  const specs = boneSpecs();
  const idx = new Map(specs.map((s, i) => [s.name, i]));
  const I = (n: string): number => {
    const i = idx.get(n);
    if (i === undefined) throw new Error(`fixture bone ${n}`);
    return i;
  };
  const bones: PmxBone[] = specs.map((s) => ({
    name: s.name,
    nameEn: s.nameEn,
    position: [...s.pos],
    parent: s.parent ? I(s.parent) : -1,
    layer: 0,
    flags: s.flags ?? R,
    tail: [0, 0, 0],
  }));
  // Tails: first standard child, or an offset.
  const kids: number[][] = bones.map(() => []);
  bones.forEach((b, i) => b.parent >= 0 && kids[b.parent].push(i));
  bones.forEach((b, i) => {
    const k = kids[i].find(
      (c) => !/ＩＫ|捩|スカート|肩|親指|薬指|人指/.test(bones[c].name) || kids[i].length === 1,
    );
    if (k !== undefined && !/ＩＫ/.test(b.name)) {
      b.tail = k;
      b.flags |= BoneFlag.TailIsBone;
    } else b.tail = /ＩＫ/.test(b.name) ? [0, 0, 1] : [0, -0.5, 0];
  });
  for (const J of ['左', '右']) {
    const tw = bones[I(`${J}腕捩`)];
    const a = bones[I(`${J}腕`)].position;
    const e = bones[I(`${J}ひじ`)].position;
    tw.fixedAxis = norm([e[0] - a[0], e[1] - a[1], e[2] - a[2]]);
    tw.tail = [0, 0, 0];
    tw.flags &= ~BoneFlag.TailIsBone;
    const ik = bones[I(`${J}足ＩＫ`)];
    ik.flags |= BoneFlag.IK;
    ik.ik = {
      target: I(`${J}足首`),
      loop: 40,
      limit: 2,
      links: [
        { bone: I(`${J}ひざ`), limit: { min: [-Math.PI, 0, 0], max: [-0.008726646, 0, 0] } },
        { bone: I(`${J}足`) },
      ],
    };
    const tik = bones[I(`${J}つま先ＩＫ`)];
    tik.flags |= BoneFlag.IK;
    tik.ik = { target: I(`${J}つま先`), loop: 3, limit: 4, links: [{ bone: I(`${J}足首`) }] };
  }

  const MATS: readonly MatName[] = opts.npr ? [...FIXTURE_MATERIALS, ...NPR_MATERIALS] : FIXTURE_MATERIALS;
  const wanted = new Set<string>(opts.materials ?? MATS);
  const g: Builder = { vertices: [], faces: MATS.map(() => []) };
  const M = (n: MatName): number => MATS.indexOf(n);
  const P = (n: string): V3 => bones[I(n)].position;
  const off = (p: V3, d: V3): V3 => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];

  // Head and hair.
  tube(
    g,
    M('顔'),
    off(P('頭'), [0, -0.4, 0]),
    off(P('頭'), [0, 2.4, 0]),
    (t) => 0.4 + Math.sin(t * Math.PI) * 1.0,
    () => [[I('頭')], [1]],
    6,
    10,
  );
  tube(
    g,
    M('髪'),
    off(P('頭'), [0, 1.2, 0.2]),
    off(P('頭'), [0, 2.8, 0.3]),
    (t) => 1.25 - t * 0.5,
    () => [[I('頭')], [1]],
    3,
    10,
  );
  tube(
    g,
    M('リボン'),
    off(P('頭'), [-0.6, 2.7, 0.3]),
    off(P('頭'), [0.6, 2.7, 0.3]),
    () => 0.25,
    () => [[I('頭')], [1]],
    2,
    6,
  );
  // Neck, torso (body skin), top over the torso.
  tube(g, M('体'), P('首'), P('頭'), () => 0.35, blendIn(I('上半身2'), I('首')), 3);
  tube(
    g,
    M('体'),
    P('下半身'),
    P('首'),
    (t) => 1.05 - t * 0.2,
    (t) => (t < 0.4 ? [[I('上半身')], [1]] : blendIn(I('上半身'), I('上半身2'), 0.6)(t - 0.4)),
    6,
  );
  tube(
    g,
    M('体'),
    off(P('下半身'), [0, -1.6, 0]),
    P('下半身'),
    () => 1.0,
    () => [[I('下半身')], [1]],
    3,
  );
  tube(
    g,
    M('トップス'),
    off(P('下半身'), [0, 0.2, 0]),
    off(P('首'), [0, -0.3, 0]),
    (t) => 1.12 - t * 0.2,
    (t) => (t < 0.4 ? [[I('上半身')], [1]] : [[I('上半身2')], [1]]),
    5,
  );
  // Skirt: a cone weighted along the four chains (nearest chain by angle).
  {
    const rings = 3;
    const sides = 12;
    const start = g.vertices.length;
    const top = P('下半身')[1] - 0.1;
    for (let r = 0; r <= rings; r++)
      for (let s = 0; s < sides; s++) {
        const ang = (s / sides) * Math.PI * 2;
        const rad = 1.15 + r * 0.55;
        const x = Math.cos(ang) * rad;
        const z = Math.sin(ang) * rad;
        const dir = Math.abs(x) > Math.abs(z) ? (x > 0 ? '左' : '右') : z > 0 ? '後' : '前';
        const bone = r === 0 ? I('下半身') : I(`スカート${dir}${r}`);
        g.vertices.push({
          position: [x, top - r * 1.3, z],
          normal: norm([x, 0.3, z]),
          uv: [s / sides, r / rings],
          bones: [bone],
          weights: [1],
          edgeScale: 1,
        });
      }
    const f = g.faces[M('スカート')];
    for (let r = 0; r < rings; r++)
      for (let s = 0; s < sides; s++) {
        const i0 = start + r * sides + s;
        const i1 = start + r * sides + ((s + 1) % sides);
        f.push(i0, i1, i0 + sides, i1, i1 + sides, i0 + sides);
      }
  }
  for (const J of ['左', '右']) {
    // Arms: shoulder → elbow → wrist, blending across each joint.
    tube(g, M('体'), P(`${J}肩`), P(`${J}腕`), () => 0.45, blendIn(I('上半身2'), I(`${J}肩`)), 2);
    tube(g, M('体'), P(`${J}腕`), P(`${J}腕捩`), () => 0.42, blendIn(I(`${J}肩`), I(`${J}腕`)), 3);
    tube(g, M('体'), P(`${J}腕捩`), P(`${J}ひじ`), () => 0.4, blendIn(I(`${J}腕`), I(`${J}腕捩`), 0.5), 3);
    tube(
      g,
      M('体'),
      P(`${J}ひじ`),
      P(`${J}手首`),
      (t) => 0.38 - t * 0.08,
      blendIn(I(`${J}腕捩`), I(`${J}ひじ`)),
      5,
    );
    // Hand (glove) and fingers.
    tube(
      g,
      M('手袋'),
      P(`${J}手首`),
      off(P(`${J}手首`), [(J === '左' ? 1 : -1) * 0.9, 0, 0]),
      () => 0.32,
      blendIn(I(`${J}ひじ`), I(`${J}手首`), 0.3),
      3,
    );
    for (const f of ['親指', '人指', '中指', '薬指']) {
      const segs = f === '親指' ? ['１', '２'] : ['１', '２', '３'];
      segs.forEach((k, i) => {
        const a = P(`${J}${f}${k}`);
        const b =
          i + 1 < segs.length
            ? P(`${J}${f}${segs[i + 1]}`)
            : off(a, [(J === '左' ? 1 : -1) * 0.3, 0, f === '親指' ? -0.15 : 0]);
        const parent = i === 0 ? I(`${J}手首`) : I(`${J}${f}${segs[i - 1]}`);
        tube(g, M('手袋'), a, b, () => 0.08, blendIn(parent, I(`${J}${f}${k}`), 0.3), 2, 5);
      });
    }
    // Legs and shoes.
    tube(
      g,
      M('体'),
      off(P(`${J}足`), [0, 0.4, 0]),
      P(`${J}ひざ`),
      (t) => 0.7 - t * 0.2,
      blendIn(I('下半身'), I(`${J}足`), 0.15),
      6,
    );
    tube(
      g,
      M('体'),
      P(`${J}ひざ`),
      off(P(`${J}足首`), [0, 0.3, 0]),
      (t) => 0.5 - t * 0.15,
      blendIn(I(`${J}足`), I(`${J}ひざ`), 0.15),
      6,
    );
    tube(
      g,
      M('靴'),
      off(P(`${J}足首`), [0, 0.5, 0.2]),
      off(P(`${J}足首`), [0, -1.0, 0.2]),
      () => 0.42,
      blendIn(I(`${J}ひざ`), I(`${J}足首`), 0.3),
      2,
    );
    tube(
      g,
      M('靴'),
      off(P(`${J}足首`), [0, -0.75, 0.3]),
      off(P(`${J}つま先`), [0, 0.25, 0]),
      () => 0.3,
      (t) =>
        t < 0.5
          ? [[I(`${J}足首`)], [1]]
          : [
              [I(`${J}足首`), I(`${J}つま先`)],
              [0.5, 0.5],
            ],
      2,
    );
  }

  if (opts.npr) {
    // Eyes on the face front, knee socks over the shins, a metal belt ring around the waist.
    const h = P('頭');
    for (const sx of [-1, 1])
      tube(
        g,
        M('目'),
        off(h, [sx * 0.42, 1.05, -1.25]),
        off(h, [sx * 0.42, 1.05, -1.42]),
        () => 0.2,
        () => [[I('頭')], [1]],
        2,
        10,
      );
    // Bangs: a strand of hair across the eyes (see-through hair test).
    tube(
      g,
      M('髪'),
      off(h, [-0.75, 1.08, -1.62]),
      off(h, [0.75, 1.08, -1.62]),
      () => 0.1,
      () => [[I('頭')], [1]],
      2,
      6,
    );
    for (const J of ['左', '右'])
      tube(
        g,
        M('ニーソ'),
        off(P(`${J}ひざ`), [0, 0.6, 0]),
        off(P(`${J}足首`), [0, 0.35, 0]),
        (t) => 0.54 - t * 0.15,
        blendIn(I(`${J}足`), I(`${J}ひざ`), 0.15),
        6,
        10,
      );
    tube(
      g,
      M('ベルト金具'),
      off(P('下半身'), [0, -0.05, 0]),
      off(P('下半身'), [0, 0.3, 0]),
      () => 1.2,
      () => [[I('下半身')], [1]],
      1,
      16,
    );
  }

  // Materials (only the wanted ones keep faces; vertices of dropped materials are compacted away).
  const topColor = opts.topColor ?? [0.3, 0.45, 0.8];
  const materials: PmxMaterial[] = [
    matDef('髪', 'hair', [0.35, 0.2, 0.12]),
    matDef('顔', 'face', [1, 0.86, 0.78], 0),
    matDef('体', 'body skin', [1, 0.85, 0.76]),
    matDef(opts.topName ?? 'トップス', opts.topName ? 'jacket' : 'top', topColor, 1),
    matDef('スカート', 'skirt', [0.2, 0.2, 0.3]),
    matDef('靴', 'shoes', [0.25, 0.15, 0.1]),
    matDef('手袋', 'gloves', [0.95, 0.95, 0.95]),
    matDef('リボン', 'ribbon', [0.9, 0.2, 0.3]),
    ...(opts.npr
      ? [
          matDef('目', 'eye', [0.25, 0.45, 0.85]),
          {
            ...matDef('ニーソ', 'knee socks', [0.12, 0.1, 0.14]),
            diffuse: [0.12, 0.1, 0.14, 0.85] as [number, number, number, number],
          },
          {
            ...matDef('ベルト金具', 'belt metal', [0.85, 0.8, 0.6]),
            shininess: 60,
            specular: [0.9, 0.9, 0.8] as [number, number, number],
          },
        ]
      : []),
  ];
  const keep = MATS.map(
    (n) => wanted.has(n) || (n === 'トップス' && opts.topName !== undefined && wanted.has(opts.topName)),
  );
  const used = new Set<number>();
  keep.forEach((k, m) => k && g.faces[m].forEach((v) => used.add(v)));
  const remap = new Map<number, number>();
  const vertices: PmxVertex[] = [];
  g.vertices.forEach((v, i) => {
    if (!used.has(i)) return;
    remap.set(i, vertices.length);
    vertices.push(v);
  });
  const indices: number[] = [];
  const outMats: PmxMaterial[] = [];
  keep.forEach((k, m) => {
    if (!k) return;
    for (const v of g.faces[m]) indices.push(remap.get(v)!);
    outMats.push({ ...materials[m], indexCount: g.faces[m].length });
  });
  const textures = ['tex/face.png', 'tex/top.png'];
  // Re-point texture indices to only the textures still used.
  const usedTex = [...new Set(outMats.map((m) => m.texture).filter((t) => t >= 0))].sort();
  for (const m of outMats) m.texture = m.texture < 0 ? -1 : usedTex.indexOf(m.texture);
  const texPaths = usedTex.map((t) => textures[t]);

  // Morphs (only when the face is present).
  const morphs: PmxMorph[] = [];
  const faceMat = outMats.findIndex((m) => m.name === '顔');
  if (faceMat >= 0) {
    const head = P('頭');
    const faceVerts = vertices
      .map((v, i) => [v, i] as const)
      .filter(
        ([v]) =>
          v.bones[0] === I('頭') &&
          v.position[2] < -0.5 &&
          v.position[1] > head[1] + 0.2 &&
          v.position[1] < head[1] + 2,
      );
    const eyes = faceVerts.filter(([v]) => v.position[1] > head[1] + 1.1);
    const mouth = faceVerts.filter(([v]) => v.position[1] < head[1] + 0.8);
    morphs.push(
      {
        kind: 'vertex',
        name: 'まばたき',
        nameEn: 'blink',
        panel: 2,
        offsets: eyes.map(([, i]) => ({ vertex: i, offset: [0, -0.15, 0] })),
      },
      {
        kind: 'vertex',
        name: 'あ',
        nameEn: 'a',
        panel: 3,
        offsets: mouth.map(([, i]) => ({ vertex: i, offset: [0, -0.2, 0.05] })),
      },
      {
        kind: 'vertex',
        name: 'にこり',
        nameEn: 'cheerful',
        panel: 1,
        offsets: eyes.map(([, i]) => ({ vertex: i, offset: [0, 0.08, 0] })),
      },
      {
        kind: 'group',
        name: '笑顔',
        nameEn: 'smile',
        panel: 4,
        offsets: [
          { morph: 0, weight: 0.6 },
          { morph: 2, weight: 1 },
        ],
      },
      {
        kind: 'bone',
        name: 'うなずき',
        nameEn: 'nod',
        panel: 4,
        offsets: [{ bone: I('頭'), position: [0, 0, 0], rotation: [0.13, 0, 0, 0.99] }],
      },
      {
        kind: 'material',
        name: '照れ',
        nameEn: 'blush',
        panel: 4,
        offsets: [
          {
            material: faceMat,
            op: 1,
            diffuse: [0.2, -0.05, -0.05, 0],
            specular: [0, 0, 0],
            shininess: 0,
            ambient: [0, 0, 0],
            edgeColor: [0, 0, 0, 0],
            edgeSize: 0,
            texture: [0, 0, 0, 0],
            sphere: [0, 0, 0, 0],
            toon: [0, 0, 0, 0],
          },
        ],
      },
    );
  }

  // Physics: body colliders + skirt chains (the converter's generator).
  const extras = bones.map((b, i) => (/^スカート/.test(b.name) ? i : -1)).filter((i) => i >= 0);
  const chains = detectChains(bones, extras);
  const phys = buildPhysics(bones, chains, DEFAULT_PHYSICS, 20);

  const frames = [
    { name: 'Root', nameEn: 'Root', special: true, items: [{ kind: 'bone' as const, index: I('全ての親') }] },
    {
      name: '表情',
      nameEn: 'Exp',
      special: true,
      items: morphs.map((_, i) => ({ kind: 'morph' as const, index: i })),
    },
    {
      name: '体',
      nameEn: 'Body',
      special: false,
      items: ['センター', '下半身', '上半身', '上半身2', '首', '頭'].map((n) => ({
        kind: 'bone' as const,
        index: I(n),
      })),
    },
    {
      name: '腕',
      nameEn: 'Arms',
      special: false,
      items: bones
        .map((b, i) => [b, i] as const)
        .filter(([b]) => /肩|腕|ひじ|手首|指/.test(b.name))
        .map(([, i]) => ({ kind: 'bone' as const, index: i })),
    },
    {
      name: '足',
      nameEn: 'Legs',
      special: false,
      items: bones
        .map((b, i) => [b, i] as const)
        .filter(([b]) => /足|ひざ|つま先/.test(b.name))
        .map(([, i]) => ({ kind: 'bone' as const, index: i })),
    },
    {
      name: 'スカート',
      nameEn: 'Skirt',
      special: false,
      items: extras.map((i) => ({ kind: 'bone' as const, index: i })),
    },
  ];

  const pmx: PmxModel = {
    name: opts.name ?? 'エディットテスト',
    nameEn: opts.nameEn ?? 'EditTest',
    comment: 'Procedural test model for MMD Studio. Free to use.',
    commentEn: 'Procedural test model for MMD Studio. Free to use.',
    vertices,
    indices,
    textures: texPaths,
    materials: outMats,
    bones,
    morphs,
    frames,
    rigidBodies: phys.rigidBodies,
    joints: phys.joints,
  };
  const pngs: Record<string, Uint8Array> = {
    'tex/face.png': checkerPng(16, [255, 220, 200], [240, 200, 185]),
    'tex/top.png': checkerPng(16, [255, 255, 255], [200, 210, 255]),
  };
  return { pmx, textures: Object.fromEntries(texPaths.map((p) => [p, pngs[p]])) };
}
