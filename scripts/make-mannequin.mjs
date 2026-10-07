// Procedurally generates "Mannequin" — an original, public-domain PMX 2.0 test model with the standard MMD
// bone set (上半身2, shoulders, wrists, knees, ankles, toes) and real leg IK (足ＩＫ / つま先ＩＫ).
// Used to validate Video→VMD retargeting and foot IK against babylon-mmd's IK solver.
// Output: e2e/fixtures/Mannequin/mannequin.pmx
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

class Writer {
  constructor() {
    this.buf = Buffer.alloc(1 << 18);
    this.o = 0;
  }
  ensure(n) {
    if (this.o + n > this.buf.length) {
      const nb = Buffer.alloc(Math.max(this.buf.length * 2, this.o + n));
      this.buf.copy(nb);
      this.buf = nb;
    }
  }
  u8(v) {
    this.ensure(1);
    this.buf.writeUInt8(v, this.o++);
  }
  i8(v) {
    this.ensure(1);
    this.buf.writeInt8(v, this.o++);
  }
  u16(v) {
    this.ensure(2);
    this.buf.writeUInt16LE(v, this.o);
    this.o += 2;
  }
  i16(v) {
    this.ensure(2);
    this.buf.writeInt16LE(v, this.o);
    this.o += 2;
  }
  i32(v) {
    this.ensure(4);
    this.buf.writeInt32LE(v, this.o);
    this.o += 4;
  }
  f32(v) {
    this.ensure(4);
    this.buf.writeFloatLE(v, this.o);
    this.o += 4;
  }
  vec(a) {
    for (const v of a) this.f32(v);
  }
  bytes(b) {
    this.ensure(b.length);
    Buffer.from(b).copy(this.buf, this.o);
    this.o += b.length;
  }
  text(s) {
    const b = Buffer.from(s, 'utf16le');
    this.i32(b.length);
    this.bytes(b);
  }
  result() {
    return this.buf.subarray(0, this.o);
  }
}

// ---------- bones ----------
const bones = [];
const idx = new Map();
const bone = (name, parent, pos, extra = {}) => {
  bones.push({ name, parent: parent === null ? -1 : idx.get(parent), pos, flags: 0x001a, ...extra });
  idx.set(name, bones.length - 1);
};
bone('全ての親', null, [0, 0, 0], { flags: 0x001e });
bone('センター', '全ての親', [0, 8, 0], { flags: 0x001e });
bone('グルーブ', 'センター', [0, 8.2, 0], { flags: 0x001e });
bone('上半身', 'グルーブ', [0, 11.6, 0.2]);
bone('上半身2', '上半身', [0, 13.0, 0.3]);
bone('首', '上半身2', [0, 15.6, 0.4]);
bone('頭', '首', [0, 16.4, 0.3]);
bone('下半身', 'グルーブ', [0, 11.6, 0.2]);
for (const [s, k] of [
  ['左', 1],
  ['右', -1],
]) {
  bone(`${s}肩`, '上半身2', [0.25 * k, 15.3, 0.5]);
  bone(`${s}腕`, `${s}肩`, [1.5 * k, 15.0, 0.6]);
  bone(`${s}ひじ`, `${s}腕`, [3.3 * k, 13.5, 0.7]);
  bone(`${s}手首`, `${s}ひじ`, [5.0 * k, 12.0, 0.7]);
  bone(`${s}中指１`, `${s}手首`, [5.8 * k, 11.3, 0.65]);
  bone(`${s}人指１`, `${s}手首`, [5.7 * k, 11.4, 0.35]);
  bone(`${s}小指１`, `${s}手首`, [5.6 * k, 11.3, 1.0]);
  bone(`${s}足`, '下半身', [0.9 * k, 10.6, 0.3]);
  bone(`${s}ひざ`, `${s}足`, [0.95 * k, 6.0, 0.2]);
  bone(`${s}足首`, `${s}ひざ`, [1.0 * k, 1.3, 0.6]);
  bone(`${s}つま先`, `${s}足首`, [1.0 * k, 0.0, -1.4]);
}
for (const s of ['左', '右']) {
  const k = s === '左' ? 1 : -1;
  bone(`${s}足ＩＫ`, '全ての親', [1.0 * k, 1.3, 0.6], {
    flags: 0x003e,
    ik: {
      target: `${s}足首`,
      loop: 40,
      limit: 2.0,
      // Knees only bend backward: rotation about X between -180° and -0.5°.
      links: [
        { bone: `${s}ひざ`, min: [-Math.PI, 0, 0], max: [-0.5 * (Math.PI / 180), 0, 0] },
        { bone: `${s}足` },
      ],
    },
  });
  bone(`${s}つま先ＩＫ`, `${s}足ＩＫ`, [1.0 * k, 0.0, -1.4], {
    flags: 0x003e,
    ik: { target: `${s}つま先`, loop: 3, limit: 4.0, links: [{ bone: `${s}足首` }] },
  });
}

// ---------- geometry: oriented boxes per segment ----------
const verts = [];
const materials = [];
let cur = null;
const material = (name, diffuse) => {
  cur = { name, diffuse, indices: [] };
  materials.push(cur);
};
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, s) => a.map((v) => v * s);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(...a));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const P = (n) => bones[idx.get(n)].pos;

/** Box from a to b with half-thickness (tu, tv), weighted to one bone. */
function segment(a, b, tu, tv, boneName) {
  const d = norm(sub(b, a));
  const ref = Math.abs(d[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = norm(cross(d, ref));
  const v = cross(u, d);
  const corner = (end, su, sv) => add(add(end, mul(u, su * tu)), mul(v, sv * tv));
  const c = [
    corner(a, -1, -1),
    corner(a, 1, -1),
    corner(a, 1, 1),
    corner(a, -1, 1),
    corner(b, -1, -1),
    corner(b, 1, -1),
    corner(b, 1, 1),
    corner(b, -1, 1),
  ];
  const center = mul(add(a, b), 0.5);
  const quads = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 4, 0],
  ];
  const bi = idx.get(boneName);
  for (const q of quads) {
    const p = q.map((i) => c[i]);
    let n = norm(cross(sub(p[1], p[0]), sub(p[2], p[0])));
    const mid = mul(add(add(p[0], p[1]), add(p[2], p[3])), 0.25);
    // Outward normal; MMD front faces have cross(v1 - v0, v2 - v0) pointing outward.
    if (dot(n, sub(mid, center)) < 0) {
      p.reverse();
      n = mul(n, -1);
    }
    const base = verts.length;
    p.forEach((pos, i) => verts.push({ p: pos, n, uv: [i & 1, i >> 1], b: bi }));
    cur.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

material('肌', [1, 0.86, 0.76, 1]);
segment([0, 15.5, 0.4], [0, 16.4, 0.4], 0.35, 0.35, '首');
segment([0, 16.3, 0.3], [0, 18.6, 0.3], 1.0, 1.1, '頭');
for (const s of ['左', '右']) {
  segment(P(`${s}腕`), P(`${s}ひじ`), 0.38, 0.38, `${s}腕`);
  segment(P(`${s}ひじ`), P(`${s}手首`), 0.33, 0.33, `${s}ひじ`);
  segment(P(`${s}手首`), P(`${s}中指１`), 0.3, 0.12, `${s}手首`);
  segment(P(`${s}ひざ`), P(`${s}足首`), 0.42, 0.42, `${s}ひざ`);
}
material('服', [0.28, 0.42, 0.85, 1]);
segment([0, 11.4, 0.2], [0, 13.2, 0.25], 1.2, 0.75, '上半身');
segment([0, 13.0, 0.3], [0, 15.4, 0.4], 1.35, 0.8, '上半身2');
segment([0, 9.6, 0.2], [0, 11.6, 0.2], 1.25, 0.8, '下半身');
for (const s of ['左', '右']) {
  segment(P(`${s}肩`), P(`${s}腕`), 0.4, 0.4, `${s}肩`);
  segment(P(`${s}足`), P(`${s}ひざ`), 0.55, 0.55, `${s}足`);
}
material('靴', [0.15, 0.15, 0.18, 1]);
for (const s of ['左', '右']) {
  const a = P(`${s}足首`);
  const t = P(`${s}つま先`);
  segment([a[0], 0.45, 0.9], [t[0], 0.45, t[2]], 0.45, 0.45, `${s}足首`);
}

// ---------- PMX ----------
const w = new Writer();
w.bytes(Buffer.from('PMX ', 'ascii'));
w.f32(2.0);
w.u8(8);
w.bytes([0, 0, 4, 1, 1, 2, 1, 2]);
w.text('マネキン');
w.text('Mannequin');
w.text('MMD Studio procedural test model with standard bones and leg IK. Public domain.');
w.text('MMD Studio procedural test model with standard bones and leg IK. Public domain.');
w.i32(verts.length);
for (const v of verts) {
  w.vec(v.p);
  w.vec(v.n);
  w.vec(v.uv);
  w.u8(0);
  w.i16(v.b);
  w.f32(1);
}
const all = materials.flatMap((m) => m.indices);
w.i32(all.length);
for (const i of all) w.i32(i);
w.i32(0); // textures
w.i32(materials.length);
for (const m of materials) {
  w.text(m.name);
  w.text(m.name);
  w.vec(m.diffuse);
  w.vec([0.2, 0.2, 0.2]);
  w.f32(10);
  w.vec(m.diffuse.slice(0, 3).map((c) => c * 0.5));
  w.u8(0x10 | 0x04 | 0x08 | 0x02);
  w.vec([0, 0, 0, 1]);
  w.f32(0.6);
  w.i8(-1);
  w.i8(-1);
  w.u8(0);
  w.u8(1);
  w.u8(1);
  w.text('');
  w.i32(m.indices.length);
}
w.i32(bones.length);
for (const b of bones) {
  w.text(b.name);
  w.text(b.name);
  w.vec(b.pos);
  w.i16(b.parent);
  w.i32(0);
  w.u16(b.flags & ~0x0001);
  w.vec([0, -1, 0]);
  if (b.ik) {
    w.i16(idx.get(b.ik.target));
    w.i32(b.ik.loop);
    w.f32(b.ik.limit);
    w.i32(b.ik.links.length);
    for (const l of b.ik.links) {
      w.i16(idx.get(l.bone));
      w.u8(l.min ? 1 : 0);
      if (l.min) {
        w.vec(l.min);
        w.vec(l.max);
      }
    }
  }
}
w.i32(0); // morphs
w.i32(1); // display frames: Root
w.text('Root');
w.text('Root');
w.u8(1);
w.i32(1);
w.u8(0);
w.i16(0);
w.i32(0); // rigid bodies
w.i32(0); // joints

const out = 'e2e/fixtures/Mannequin/mannequin.pmx';
mkdirSync(dirname(join(process.cwd(), out)), { recursive: true });
writeFileSync(out, w.result());
console.log(`wrote ${out} (${verts.length} verts, ${bones.length} bones)`);
