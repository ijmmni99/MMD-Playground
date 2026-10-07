// Procedurally generates a tiny, original MMD test kit (no third-party assets):
//   sample/Blocky/blocky.pmx        PMX 2.0 model: bones, physics hair, morphs, textures in a sub-folder
//   sample/Blocky/tex/skin.png      referenced as "tex/skin.png"
//   sample/Blocky/tex/hair.png      referenced as "Tex\\Hair.PNG" (tests case + separator handling)
//   sample/dance.vmd                model motion (bones + morphs, 240 frames)
//   sample/camera.vmd               camera motion
//   sample/beat.wav                 8 s generated audio
// Output goes to public/sample (served for the "Load sample" button) and e2e/fixtures.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import Encoding from 'encoding-japanese';

// ---------- binary writer ----------
class Writer {
  constructor() {
    this.buf = Buffer.alloc(1 << 20);
    this.o = 0;
  }
  ensure(n) {
    if (this.o + n > this.buf.length) {
      const nb = Buffer.alloc(Math.max(this.buf.length * 2, this.o + n));
      this.buf.copy(nb);
      this.buf = nb;
    }
  }
  u8(v) { this.ensure(1); this.buf.writeUInt8(v, this.o); this.o += 1; }
  i8(v) { this.ensure(1); this.buf.writeInt8(v, this.o); this.o += 1; }
  u16(v) { this.ensure(2); this.buf.writeUInt16LE(v, this.o); this.o += 2; }
  i16(v) { this.ensure(2); this.buf.writeInt16LE(v, this.o); this.o += 2; }
  i32(v) { this.ensure(4); this.buf.writeInt32LE(v, this.o); this.o += 4; }
  u32(v) { this.ensure(4); this.buf.writeUInt32LE(v, this.o); this.o += 4; }
  f32(v) { this.ensure(4); this.buf.writeFloatLE(v, this.o); this.o += 4; }
  vec(a) { for (const v of a) this.f32(v); }
  bytes(b) { this.ensure(b.length); Buffer.from(b).copy(this.buf, this.o); this.o += b.length; }
  text(s) { const b = Buffer.from(s, 'utf16le'); this.i32(b.length); this.bytes(b); }
  fixedSjis(s, len) {
    const arr = Encoding.convert(Encoding.stringToCode(s), { to: 'SJIS', from: 'UNICODE' });
    const b = Buffer.alloc(len);
    Buffer.from(arr.slice(0, len)).copy(b);
    this.bytes(b);
  }
  result() { return this.buf.subarray(0, this.o); }
}

// ---------- PNG ----------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = y * (w * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- model definition ----------
const bones = [];
const bone = (name, parent, pos, flags = 0x001e) => { bones.push({ name, parent, pos, flags }); return bones.length - 1; };
const ROOT = bone('全ての親', -1, [0, 0, 0]);
const CENTER = bone('センター', ROOT, [0, 8, 0]);
const LOWER = bone('下半身', CENTER, [0, 10, 0], 0x001a);
const UPPER = bone('上半身', CENTER, [0, 10, 0], 0x001a);
const NECK = bone('首', UPPER, [0, 15, 0], 0x001a);
const HEAD = bone('頭', NECK, [0, 16, 0], 0x001a);
const ARM_L = bone('左腕', UPPER, [1.7, 14.6, 0], 0x001a);
const ELBOW_L = bone('左ひじ', ARM_L, [2.3, 11.8, 0], 0x001a);
const ARM_R = bone('右腕', UPPER, [-1.7, 14.6, 0], 0x001a);
const ELBOW_R = bone('右ひじ', ARM_R, [-2.3, 11.8, 0], 0x001a);
const LEG_L = bone('左足', LOWER, [0.8, 9.6, 0], 0x001a);
const LEG_R = bone('右足', LOWER, [-0.8, 9.6, 0], 0x001a);
const hair = { L: [], R: [] };
for (const side of ['L', 'R']) {
  const sx = side === 'L' ? 1.3 : -1.3;
  let parent = HEAD;
  for (let i = 0; i < 5; i++) {
    parent = bone(`髪${side}${i + 1}`, parent, [sx, 18.6 - i * 1.4, 0.9], 0x001a);
    hair[side].push(parent);
  }
}
// skirt: 4 short chains
const skirt = [];
for (let k = 0; k < 4; k++) {
  const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
  const chain = [];
  let parent = LOWER;
  for (let i = 0; i < 2; i++) {
    parent = bone(`スカート${k + 1}_${i + 1}`, parent, [Math.cos(a) * 1.6, 9.8 - i * 1.3, Math.sin(a) * 1.1], 0x001a);
    chain.push(parent);
  }
  skirt.push({ a, chain });
}

// geometry grouped by material
const materials = [];
const verts = [];
const morphOffsets = {}; // name -> [[vertexIndex, [dx,dy,dz]]]
let curMat = null;
const startMaterial = (m) => { curMat = { ...m, indices: [] }; materials.push(curMat); };
function box(c, s, boneIdx, opts = {}) {
  const [cx, cy, cz] = c; const [hx, hy, hz] = s.map((v) => v / 2);
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
    [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
  ];
  const uvs = [[0, 1], [0, 0], [1, 0], [1, 1]];
  const first = verts.length;
  for (const [n, quad] of faces) {
    const base = verts.length;
    quad.forEach((q, i) => {
      const p = [cx + q[0] * hx, cy + q[1] * hy, cz + q[2] * hz];
      const w = typeof boneIdx === 'function' ? boneIdx(p) : { b: [boneIdx], w: [1] };
      verts.push({ p, n, uv: uvs[i], w, local: q });
    });
    // clockwise winding for left-handed MMD
    curMat.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  if (opts.morph) {
    for (let i = first; i < verts.length; i++) {
      const d = opts.morph(verts[i].local);
      if (d) (morphOffsets[opts.morphName] ??= []).push([i, d]);
    }
  }
}
const blend = (lo, hi, y0, y1) => (p) => {
  const t = Math.min(1, Math.max(0, (p[1] - y0) / (y1 - y0)));
  return t <= 0 ? { b: [lo], w: [1] } : t >= 1 ? { b: [hi], w: [1] } : { b: [lo, hi], w: [1 - t, t] };
};

startMaterial({ name: '肌', tex: 0, diffuse: [1, 1, 1, 1], edge: 1 });
box([0, 17.6, 0], [3, 3, 3], HEAD);
box([0, 15.4, 0], [0.9, 1, 0.9], NECK);
box([1.95, 13.2, 0], [0.8, 2.6, 0.8], ARM_L);
box([2.45, 10.6, 0], [0.7, 2.4, 0.7], ELBOW_L);
box([-1.95, 13.2, 0], [0.8, 2.6, 0.8], ARM_R);
box([-2.45, 10.6, 0], [0.7, 2.4, 0.7], ELBOW_R);
box([0.8, 6.4, 0], [1, 6.4, 1], LEG_L);
box([-0.8, 6.4, 0], [1, 6.4, 1], LEG_R);
startMaterial({ name: '服', tex: -1, diffuse: [0.35, 0.55, 0.95, 1], edge: 1 });
box([0, 12.6, 0], [3, 4.4, 1.8], blend(LOWER, UPPER, 9.8, 11));
for (const { a, chain } of skirt) {
  const x = Math.cos(a), z = Math.sin(a);
  box([x * 1.6, 9.2, z * 1.1], [1.6, 1.3, 0.3], chain[0]);
  box([x * 1.75, 7.9, z * 1.25], [1.6, 1.3, 0.3], chain[1]);
}
startMaterial({ name: '髪', tex: 1, diffuse: [1, 1, 1, 1], edge: 1 });
box([0, 19.3, 0.2], [3.3, 0.8, 3.4], HEAD);
for (const side of ['L', 'R']) {
  const sx = side === 'L' ? 1.3 : -1.3;
  hair[side].forEach((b, i) => box([sx, 17.9 - i * 1.4, 0.9], [0.7, 1.4, 0.7], b));
}
startMaterial({ name: '顔', tex: -1, diffuse: [0.1, 0.1, 0.15, 1], edge: 0 });
for (const ex of [0.65, -0.65]) {
  box([ex, 17.9, -1.52], [0.45, 0.6, 0.06], HEAD, { morphName: 'まばたき', morph: (l) => (l[1] > 0 ? [0, -0.55, 0] : null) });
  box([ex, 18.75, -1.52], [0.7, 0.12, 0.06], HEAD, { morphName: '眉上', morph: () => [0, 0.3, 0] });
}
box([0, 16.7, -1.52], [0.8, 0.15, 0.06], HEAD, { morphName: 'あ', morph: (l) => (l[1] < 0 ? [0, -0.45, 0] : null) });

// morph "笑い" (other) reuses eye vertices
morphOffsets['笑い'] = morphOffsets['まばたき'].map(([i, d]) => [i, [d[0], d[1] * 0.6, d[2]]]);
const morphs = [
  { name: '眉上', cat: 1 },
  { name: 'まばたき', cat: 2 },
  { name: 'あ', cat: 3 },
  { name: '笑い', cat: 4 },
];

// rigid bodies & joints
const rbs = [];
const rb = (o) => { rbs.push(o); return rbs.length - 1; };
const headRb = rb({ name: '頭', bone: HEAD, group: 0, mask: 0, shape: 0, size: [1.8, 0, 0], pos: [0, 17.6, 0], mode: 0, mass: 1 });
rb({ name: '上半身', bone: UPPER, group: 0, mask: 0, shape: 2, size: [1.4, 3, 0], pos: [0, 12.6, 0], mode: 0, mass: 1 });
const lowerRb = rb({ name: '下半身', bone: LOWER, group: 0, mask: 0, shape: 0, size: [1.3, 0, 0], pos: [0, 9.6, 0], mode: 0, mass: 1 });
const joints = [];
for (const side of ['L', 'R']) {
  const sx = side === 'L' ? 1.3 : -1.3;
  let prev = headRb;
  hair[side].forEach((b, i) => {
    const y = 17.9 - i * 1.4;
    const cur = rb({ name: `髪${side}${i + 1}`, bone: b, group: 1, mask: 1 << 1, shape: 2, size: [0.3, 0.8, 0], pos: [sx, y, 0.9], mode: 1, mass: 0.4 });
    joints.push({ name: `髪${side}${i + 1}`, a: prev, b: cur, pos: [sx, y + 0.7, 0.9], rotMin: [-0.6, -0.3, -0.6], rotMax: [0.6, 0.3, 0.6] });
    prev = cur;
  });
}
for (const [k, { a, chain }] of skirt.entries()) {
  let prev = lowerRb;
  chain.forEach((b, i) => {
    const pos = [Math.cos(a) * (1.6 + i * 0.15), 9.2 - i * 1.3, Math.sin(a) * (1.1 + i * 0.15)];
    const cur = rb({ name: `スカート${k + 1}_${i + 1}`, bone: b, group: 2, mask: 1 << 2, shape: 1, size: [0.7, 0.6, 0.1], pos, mode: 1, mass: 0.3 });
    joints.push({ name: `スカート${k + 1}_${i + 1}`, a: prev, b: cur, pos: [pos[0], pos[1] + 0.6, pos[2]], rotMin: [-0.5, -0.1, -0.5], rotMax: [0.5, 0.1, 0.5] });
    prev = cur;
  });
}

// ---------- PMX write ----------
function writePmx() {
  const w = new Writer();
  w.bytes(Buffer.from('PMX ', 'ascii'));
  w.f32(2.0);
  w.u8(8);
  w.bytes([0, 0, 4, 1, 1, 2, 1, 2]); // utf16, no extra uv, vtx idx 4, tex 1, mat 1, bone 2, morph 1, rb 2
  w.text('ブロッキー');
  w.text('Blocky');
  w.text('MMD Studio procedural test model. Public domain.');
  w.text('MMD Studio procedural test model. Public domain.');
  w.i32(verts.length);
  for (const v of verts) {
    w.vec(v.p); w.vec(v.n); w.vec(v.uv);
    if (v.w.b.length === 1) { w.u8(0); w.i16(v.w.b[0]); }
    else {
      w.u8(1);
      w.i16(v.w.b[0]); w.i16(v.w.b[1]);
      w.f32(v.w.w[0]);
    }
    w.f32(1);
  }
  const allIdx = materials.flatMap((m) => m.indices);
  w.i32(allIdx.length);
  for (const i of allIdx) w.i32(i);
  const textures = ['tex/skin.png', 'Tex\\Hair.PNG'];
  w.i32(textures.length);
  textures.forEach((t) => w.text(t));
  w.i32(materials.length);
  for (const m of materials) {
    w.text(m.name); w.text(m.name);
    w.vec(m.diffuse); w.vec([0.2, 0.2, 0.2]); w.f32(10); w.vec(m.diffuse.slice(0, 3).map((c) => c * 0.5));
    w.u8(m.edge ? 0x10 | 0x04 | 0x08 | 0x02 : 0x04 | 0x08);
    w.vec([0, 0, 0, 1]); w.f32(1);
    w.i8(m.tex); w.i8(-1); w.u8(0);
    w.u8(1); w.u8(1); // shared toon01
    w.text('');
    w.i32(m.indices.length);
  }
  w.i32(bones.length);
  for (const b of bones) {
    w.text(b.name); w.text(b.name);
    w.vec(b.pos);
    w.i16(b.parent);
    w.i32(0);
    w.u16(b.flags & ~0x0001);
    w.vec([0, -1, 0]);
  }
  w.i32(morphs.length);
  for (const m of morphs) {
    w.text(m.name); w.text(m.name);
    w.u8(m.cat); w.u8(1);
    const offs = morphOffsets[m.name];
    w.i32(offs.length);
    for (const [vi, d] of offs) { w.i32(vi); w.vec(d); }
  }
  // display frames: Root + 表情
  w.i32(2);
  w.text('Root'); w.text('Root'); w.u8(1); w.i32(1); w.u8(0); w.i16(0);
  w.text('表情'); w.text('Exp'); w.u8(1); w.i32(morphs.length);
  morphs.forEach((_, i) => { w.u8(1); w.i8(i); });
  w.i32(rbs.length);
  for (const r of rbs) {
    w.text(r.name); w.text(r.name);
    w.i16(r.bone);
    w.u8(r.group); w.u16(r.mask); w.u8(r.shape);
    w.vec(r.size); w.vec(r.pos); w.vec([0, 0, 0]);
    w.f32(r.mass); w.f32(0.5); w.f32(0.5); w.f32(0); w.f32(0.5);
    w.u8(r.mode);
  }
  w.i32(joints.length);
  for (const j of joints) {
    w.text(j.name); w.text(j.name);
    w.u8(0);
    w.i16(j.a); w.i16(j.b);
    w.vec(j.pos); w.vec([0, 0, 0]);
    w.vec([0, 0, 0]); w.vec([0, 0, 0]);
    w.vec(j.rotMin); w.vec(j.rotMax);
    w.vec([0, 0, 0]); w.vec([50, 50, 50]);
  }
  return w.result();
}

// ---------- VMD ----------
const quatFromEuler = (x, y, z) => {
  // MMD order: Y * X * Z
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2), cy = Math.cos(y / 2), sy = Math.sin(y / 2), cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return [
    cy * sx * cz + sy * cx * sz,
    sy * cx * cz - cy * sx * sz,
    cy * cx * sz - sy * sx * cz,
    cy * cx * cz + sy * sx * sz,
  ];
};
const LINEAR_INTERP = (() => {
  const row = [20, 20, 20, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107];
  return [...row, ...row, ...row, ...row];
})();

function writeVmd({ modelName, boneKeys = [], morphKeys = [], cameraKeys = [] }) {
  const w = new Writer();
  const header = Buffer.alloc(30); Buffer.from('Vocaloid Motion Data 0002', 'ascii').copy(header); w.bytes(header);
  w.fixedSjis(modelName, 20);
  w.u32(boneKeys.length);
  for (const k of boneKeys) { w.fixedSjis(k.name, 15); w.u32(k.frame); w.vec(k.pos); w.vec(k.rot); w.bytes(LINEAR_INTERP); }
  w.u32(morphKeys.length);
  for (const k of morphKeys) { w.fixedSjis(k.name, 15); w.u32(k.frame); w.f32(k.weight); }
  w.u32(cameraKeys.length);
  for (const k of cameraKeys) {
    w.u32(k.frame); w.f32(k.distance); w.vec(k.pos); w.vec(k.rot);
    w.bytes(Array.from({ length: 24 }, (_, i) => (i % 4 < 2 ? 20 : 107)));
    w.u32(k.fov); w.u8(0);
  }
  w.u32(0); w.u32(0); // light, shadow
  return w.result();
}

const D = Math.PI / 180;
const FRAMES = 240;
const boneKeys = [];
for (let f = 0; f <= FRAMES; f += 10) {
  const t = (f / FRAMES) * Math.PI * 2;
  boneKeys.push({ name: 'センター', frame: f, pos: [Math.sin(t) * 3, Math.abs(Math.sin(t * 4)) * 0.8, 0], rot: [0, 0, 0, 1] });
  boneKeys.push({ name: '上半身', frame: f, pos: [0, 0, 0], rot: quatFromEuler(0, Math.sin(t * 2) * 35 * D, Math.sin(t * 4) * 12 * D) });
  boneKeys.push({ name: '下半身', frame: f, pos: [0, 0, 0], rot: quatFromEuler(0, -Math.sin(t * 2) * 25 * D, 0) });
  boneKeys.push({ name: '頭', frame: f, pos: [0, 0, 0], rot: quatFromEuler(Math.sin(t * 4) * 15 * D, 0, 0) });
  boneKeys.push({ name: '左腕', frame: f, pos: [0, 0, 0], rot: quatFromEuler(0, 0, (40 + Math.sin(t * 4) * 40) * D) });
  boneKeys.push({ name: '右腕', frame: f, pos: [0, 0, 0], rot: quatFromEuler(0, 0, -(40 + Math.cos(t * 4) * 40) * D) });
  boneKeys.push({ name: '左足', frame: f, pos: [0, 0, 0], rot: quatFromEuler(Math.sin(t * 4) * 20 * D, 0, 0) });
  boneKeys.push({ name: '右足', frame: f, pos: [0, 0, 0], rot: quatFromEuler(-Math.sin(t * 4) * 20 * D, 0, 0) });
}
const morphKeys = [];
for (const f0 of [30, 110, 190]) {
  morphKeys.push({ name: 'まばたき', frame: f0, weight: 0 }, { name: 'まばたき', frame: f0 + 3, weight: 1 }, { name: 'まばたき', frame: f0 + 6, weight: 0 });
}
for (let f = 0; f <= FRAMES; f += 15) morphKeys.push({ name: 'あ', frame: f, weight: (f / 15) % 2 ? 0.8 : 0 });
const cameraKeys = [];
for (let f = 0; f <= FRAMES; f += 30) {
  const t = f / FRAMES;
  cameraKeys.push({ frame: f, distance: -30 + Math.sin(t * Math.PI * 2) * 6, pos: [0, 12, 0], rot: [8 * D, t * Math.PI * 2, 0], fov: 30 });
}

// ---------- WAV ----------
function wav(seconds = 8, rate = 22050) {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  const notes = [261.6, 329.6, 392, 523.3, 392, 329.6, 293.7, 349.2];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const beat = t * 2; // 120 bpm
    const note = notes[Math.floor(beat) % notes.length];
    const env = Math.exp(-(beat % 1) * 4);
    const kick = Math.sin(2 * Math.PI * 60 * t) * Math.exp(-(beat % 1) * 18);
    const v = 0.35 * env * Math.sin(2 * Math.PI * note * t) + 0.5 * kick;
    data.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767 * 0.6, i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const files = {
  'Blocky/blocky.pmx': writePmx(),
  'Blocky/tex/skin.png': png(64, 64, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? [255, 222, 200, 255] : [245, 205, 185, 255]),
  'Blocky/tex/hair.png': png(32, 32, (x, y) => [40 + y * 2, 190 - y, 200, 255]),
  'dance.vmd': writeVmd({ modelName: 'ブロッキー', boneKeys, morphKeys }),
  'camera.vmd': writeVmd({ modelName: 'カメラ・照明', cameraKeys }),
  'beat.wav': wav(),
};
for (const root of ['public/sample', 'e2e/fixtures']) {
  for (const [p, data] of Object.entries(files)) {
    const full = join(root, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
}
console.log('fixtures written:', Object.keys(files).join(', '), `(${verts.length} verts, ${bones.length} bones, ${rbs.length} rigid bodies)`);
