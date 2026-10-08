// PMX 2.0 writer: UTF-16LE text, index sizes chosen from the counts.

import { BoneFlag, type PmxModel, type V3 } from './types';

class Out {
  private buf = new ArrayBuffer(1 << 16);
  private dv = new DataView(this.buf);
  private u8a = new Uint8Array(this.buf);
  o = 0;
  private ensure(n: number): void {
    if (this.o + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.o + n) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.u8a.subarray(0, this.o));
    this.buf = next;
    this.dv = new DataView(next);
    this.u8a = new Uint8Array(next);
  }
  u8(v: number): void {
    this.ensure(1);
    this.dv.setUint8(this.o++, v);
  }
  i8(v: number): void {
    this.ensure(1);
    this.dv.setInt8(this.o++, v);
  }
  u16(v: number): void {
    this.ensure(2);
    this.dv.setUint16(this.o, v, true);
    this.o += 2;
  }
  i16(v: number): void {
    this.ensure(2);
    this.dv.setInt16(this.o, v, true);
    this.o += 2;
  }
  i32(v: number): void {
    this.ensure(4);
    this.dv.setInt32(this.o, v, true);
    this.o += 4;
  }
  f32(v: number): void {
    this.ensure(4);
    this.dv.setFloat32(this.o, v, true);
    this.o += 4;
  }
  vec(v: readonly number[]): void {
    for (const x of v) this.f32(x);
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.u8a.set(b, this.o);
    this.o += b.length;
  }
  /** Length-prefixed UTF-16LE text. */
  text(s: string): void {
    this.i32(s.length * 2);
    this.ensure(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      this.dv.setUint16(this.o, s.charCodeAt(i), true);
      this.o += 2;
    }
  }
  result(): ArrayBuffer {
    return this.buf.slice(0, this.o);
  }
}

/** Index size for a count: vertex indices are unsigned (1/2/4), others signed with -1 = none. */
export function indexSize(count: number, vertex = false): 1 | 2 | 4 {
  if (vertex) return count <= 0xff ? 1 : count <= 0xffff ? 2 : 4;
  return count < 0x7f ? 1 : count < 0x7fff ? 2 : 4;
}

export function writePmx(m: PmxModel): ArrayBuffer {
  const o = new Out();
  const vSize = indexSize(m.vertices.length, true);
  const tSize = indexSize(m.textures.length);
  const matSize = indexSize(m.materials.length);
  const bSize = indexSize(m.bones.length);
  const mSize = indexSize(m.morphs.length);
  const rSize = indexSize(m.rigidBodies.length);
  const signed = (size: number, v: number): void => (size === 1 ? o.i8(v) : size === 2 ? o.i16(v) : o.i32(v));
  const vIdx = (v: number): void => (vSize === 1 ? o.u8(v) : vSize === 2 ? o.u16(v) : o.i32(v));
  const bone = (v: number): void => signed(bSize, v);

  // Header.
  o.bytes(new Uint8Array([0x50, 0x4d, 0x58, 0x20])); // "PMX "
  o.f32(2.0);
  o.u8(8);
  for (const g of [0, 0, vSize, tSize, matSize, bSize, mSize, rSize]) o.u8(g);
  o.text(m.name);
  o.text(m.nameEn);
  o.text(m.comment);
  o.text(m.commentEn);

  // Vertices.
  o.i32(m.vertices.length);
  for (const v of m.vertices) {
    o.vec(v.position);
    o.vec(v.normal);
    o.vec(v.uv);
    const n = v.bones.length;
    if (n <= 1) {
      o.u8(0);
      bone(v.bones[0] ?? 0);
    } else if (n === 2) {
      o.u8(1);
      bone(v.bones[0]);
      bone(v.bones[1]);
      o.f32(v.weights[0]);
    } else {
      o.u8(2);
      for (let i = 0; i < 4; i++) bone(v.bones[i] ?? 0);
      for (let i = 0; i < 4; i++) o.f32(v.weights[i] ?? 0);
    }
    o.f32(v.edgeScale);
  }

  // Faces.
  o.i32(m.indices.length);
  for (let i = 0; i < m.indices.length; i++) vIdx(m.indices[i]);

  // Textures.
  o.i32(m.textures.length);
  for (const t of m.textures) o.text(t);

  // Materials.
  o.i32(m.materials.length);
  for (const mat of m.materials) {
    o.text(mat.name);
    o.text(mat.nameEn);
    o.vec(mat.diffuse);
    o.vec(mat.specular);
    o.f32(mat.shininess);
    o.vec(mat.ambient);
    o.u8(mat.flags);
    o.vec(mat.edgeColor);
    o.f32(mat.edgeSize);
    signed(tSize, mat.texture);
    signed(tSize, mat.sphere);
    o.u8(mat.sphereMode);
    if (mat.sharedToon >= 0) {
      o.u8(1);
      o.u8(mat.sharedToon);
    } else {
      o.u8(0);
      signed(tSize, -1);
    }
    o.text(mat.memo);
    o.i32(mat.indexCount);
  }

  // Bones.
  o.i32(m.bones.length);
  for (const b of m.bones) {
    let flags = b.flags & ~(BoneFlag.TailIsBone | BoneFlag.IK | BoneFlag.AppendRotate | BoneFlag.AppendMove | BoneFlag.FixedAxis | BoneFlag.LocalAxis);
    if (typeof b.tail === 'number') flags |= BoneFlag.TailIsBone;
    if (b.ik) flags |= BoneFlag.IK;
    if (b.append?.rotate) flags |= BoneFlag.AppendRotate;
    if (b.append?.move) flags |= BoneFlag.AppendMove;
    if (b.fixedAxis) flags |= BoneFlag.FixedAxis;
    if (b.localAxis) flags |= BoneFlag.LocalAxis;
    o.text(b.name);
    o.text(b.nameEn);
    o.vec(b.position);
    bone(b.parent);
    o.i32(b.layer);
    o.u16(flags);
    if (typeof b.tail === 'number') bone(b.tail);
    else o.vec(b.tail);
    if (b.append) {
      bone(b.append.parent);
      o.f32(b.append.ratio);
    }
    if (b.fixedAxis) o.vec(b.fixedAxis);
    if (b.localAxis) {
      o.vec(b.localAxis.x);
      o.vec(b.localAxis.z);
    }
    if (b.ik) {
      bone(b.ik.target);
      o.i32(b.ik.loop);
      o.f32(b.ik.limit);
      o.i32(b.ik.links.length);
      for (const l of b.ik.links) {
        bone(l.bone);
        if (l.limit) {
          o.u8(1);
          o.vec(l.limit.min);
          o.vec(l.limit.max);
        } else o.u8(0);
      }
    }
  }

  // Morphs.
  o.i32(m.morphs.length);
  for (const mo of m.morphs) {
    o.text(mo.name);
    o.text(mo.nameEn);
    o.u8(mo.panel);
    if (mo.kind === 'group') {
      o.u8(0);
      o.i32(mo.offsets.length);
      for (const x of mo.offsets) {
        signed(mSize, x.morph);
        o.f32(x.weight);
      }
    } else {
      o.u8(1);
      o.i32(mo.offsets.length);
      for (const x of mo.offsets) {
        vIdx(x.vertex);
        o.vec(x.offset);
      }
    }
  }

  // Display frames.
  o.i32(m.frames.length);
  for (const f of m.frames) {
    o.text(f.name);
    o.text(f.nameEn);
    o.u8(f.special ? 1 : 0);
    o.i32(f.items.length);
    for (const it of f.items) {
      o.u8(it.kind === 'bone' ? 0 : 1);
      if (it.kind === 'bone') bone(it.index);
      else signed(mSize, it.index);
    }
  }

  // Rigid bodies.
  o.i32(m.rigidBodies.length);
  for (const r of m.rigidBodies) {
    o.text(r.name);
    o.text(r.nameEn);
    bone(r.bone);
    o.u8(r.group);
    o.u16(~r.collidesWith & 0xffff);
    o.u8(r.shape);
    o.vec(r.size);
    o.vec(r.position);
    o.vec(r.rotation);
    o.f32(r.mass);
    o.f32(r.linearDamping);
    o.f32(r.angularDamping);
    o.f32(r.restitution);
    o.f32(r.friction);
    o.u8(r.mode);
  }

  // Joints.
  o.i32(m.joints.length);
  for (const j of m.joints) {
    o.text(j.name);
    o.text(j.nameEn);
    o.u8(0);
    signed(rSize, j.a);
    signed(rSize, j.b);
    for (const v of [j.position, j.rotation, j.moveMin, j.moveMax, j.rotateMin, j.rotateMax, j.springMove, j.springRotate] as V3[])
      o.vec(v);
  }
  return o.result();
}
