// babylon-mmd PmxObject → PmxModel (the shared record format the writer takes), with nothing dropped.
import { PmxReader } from 'babylon-mmd/esm/Loader/Parser/pmxReader';
import type { PmxObject } from 'babylon-mmd/esm/Loader/Parser/pmxObject';
import type {
  MorphPanel,
  PmxBone,
  PmxMaterial,
  PmxModel,
  PmxMorph,
  PmxVertex,
  V3,
  V4,
} from '@/lib/convert/pmx/types';

const v3 = (a: ArrayLike<number>): V3 => [a[0], a[1], a[2]];
const v4 = (a: ArrayLike<number>): V4 => [a[0], a[1], a[2], a[3]];

function vertex(v: PmxObject.Vertex): PmxVertex {
  const bw = v.boneWeight as { boneIndices: number | ArrayLike<number>; boneWeights: unknown };
  const out: PmxVertex = {
    position: v3(v.position),
    normal: v3(v.normal),
    uv: [v.uv[0], v.uv[1]],
    bones: [],
    weights: [],
    edgeScale: v.edgeScale,
  };
  switch (v.weightType) {
    case 0:
      out.bones = [bw.boneIndices as number];
      out.weights = [1];
      break;
    case 1: {
      const i = bw.boneIndices as ArrayLike<number>;
      const w = bw.boneWeights as number;
      out.bones = [i[0], i[1]];
      out.weights = [w, 1 - w];
      break;
    }
    case 3: {
      const i = bw.boneIndices as ArrayLike<number>;
      const s = bw.boneWeights as PmxObject.Vertex.BoneWeightSDEF;
      out.bones = [i[0], i[1]];
      out.weights = [s.boneWeight0, 1 - s.boneWeight0];
      out.sdef = { c: v3(s.c), r0: v3(s.r0), r1: v3(s.r1) };
      break;
    }
    default: {
      // BDEF4 / QDEF: drop zero-weight slots but keep at least one.
      const i = bw.boneIndices as ArrayLike<number>;
      const w = bw.boneWeights as ArrayLike<number>;
      for (let k = 0; k < 4; k++) {
        if (w[k] > 0 || (k === 0 && out.bones.length === 0 && w[1] <= 0 && w[2] <= 0 && w[3] <= 0)) {
          out.bones.push(i[k]);
          out.weights.push(w[k]);
        }
      }
      if (!out.bones.length) {
        out.bones = [i[0]];
        out.weights = [1];
      }
      if (v.weightType === 4) out.qdef = true;
    }
  }
  if (v.additionalVec4.length) out.addUv = v.additionalVec4.map(v4);
  return out;
}

function material(m: PmxObject.Material): PmxMaterial {
  return {
    name: m.name,
    nameEn: m.englishName,
    diffuse: v4(m.diffuse),
    specular: v3(m.specular),
    shininess: m.shininess,
    ambient: v3(m.ambient),
    flags: m.flag,
    edgeColor: v4(m.edgeColor),
    edgeSize: m.edgeSize,
    texture: m.textureIndex,
    sphere: m.sphereTextureIndex,
    sphereMode: m.sphereTextureMode as PmxMaterial['sphereMode'],
    sharedToon: m.isSharedToonTexture ? m.toonTextureIndex : -1,
    toon: m.isSharedToonTexture ? undefined : m.toonTextureIndex,
    memo: m.comment,
    indexCount: m.indexCount,
  };
}

function bone(b: PmxObject.Bone): PmxBone {
  const out: PmxBone = {
    name: b.name,
    nameEn: b.englishName,
    position: v3(b.position),
    parent: b.parentBoneIndex,
    layer: b.transformOrder,
    flags: b.flag,
    tail: typeof b.tailPosition === 'number' ? b.tailPosition : v3(b.tailPosition),
  };
  if (b.appendTransform && (b.flag & 0x300) !== 0)
    out.append = {
      parent: b.appendTransform.parentIndex,
      ratio: b.appendTransform.ratio,
      rotate: (b.flag & 0x100) !== 0,
      move: (b.flag & 0x200) !== 0,
    };
  if (b.axisLimit) out.fixedAxis = v3(b.axisLimit);
  if (b.localVector) out.localAxis = { x: v3(b.localVector.x), z: v3(b.localVector.z) };
  if (b.externalParentTransform !== undefined) out.externalParent = b.externalParentTransform;
  if (b.ik)
    out.ik = {
      target: b.ik.target,
      loop: b.ik.iteration,
      limit: b.ik.rotationConstraint,
      links: b.ik.links.map((l) => ({
        bone: l.target,
        ...(l.limitation
          ? { limit: { min: v3(l.limitation.minimumAngle), max: v3(l.limitation.maximumAngle) } }
          : {}),
      })),
    };
  return out;
}

function morph(m: PmxObject.Morph): PmxMorph {
  const base = { name: m.name, nameEn: m.englishName, panel: m.category as MorphPanel };
  switch (m.type) {
    case 0:
      return {
        ...base,
        kind: 'group',
        offsets: Array.from(m.indices, (morph, i) => ({ morph, weight: m.ratios[i] })),
      };
    case 9:
      return {
        ...base,
        kind: 'flip',
        offsets: Array.from(m.indices, (morph, i) => ({ morph, weight: m.ratios[i] })),
      };
    case 1:
      return {
        ...base,
        kind: 'vertex',
        offsets: Array.from(m.indices, (vertex, i) => ({
          vertex,
          offset: v3(m.positions.subarray(i * 3, i * 3 + 3)),
        })),
      };
    case 2:
      return {
        ...base,
        kind: 'bone',
        offsets: Array.from(m.indices, (b, i) => ({
          bone: b,
          position: v3(m.positions.subarray(i * 3, i * 3 + 3)),
          rotation: v4(m.rotations.subarray(i * 4, i * 4 + 4)),
        })),
      };
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
      return {
        ...base,
        kind: 'uv',
        uvIndex: m.type - 3,
        offsets: Array.from(m.indices, (vertex, i) => ({
          vertex,
          offset: v4(m.offsets.subarray(i * 4, i * 4 + 4)),
        })),
      };
    case 8:
      return {
        ...base,
        kind: 'material',
        offsets: m.elements.map((e) => ({
          material: e.index,
          op: e.type as 0 | 1,
          diffuse: v4(e.diffuse),
          specular: v3(e.specular),
          shininess: e.shininess,
          ambient: v3(e.ambient),
          edgeColor: v4(e.edgeColor),
          edgeSize: e.edgeSize,
          texture: v4(e.textureColor),
          sphere: v4(e.sphereTextureColor),
          toon: v4(e.toonTextureColor),
        })),
      };
    case 10:
      return {
        ...base,
        kind: 'impulse',
        offsets: Array.from(m.indices, (body, i) => ({
          body,
          local: m.isLocals[i],
          velocity: v3(m.velocities.subarray(i * 3, i * 3 + 3)),
          torque: v3(m.torques.subarray(i * 3, i * 3 + 3)),
        })),
      };
  }
  throw new Error(`Unsupported morph type ${(m as { type: number }).type}`);
}

export function fromPmxObject(o: PmxObject): PmxModel {
  return {
    additionalUvCount: o.header.additionalVec4Count,
    name: o.header.modelName,
    nameEn: o.header.englishModelName,
    comment: o.header.comment,
    commentEn: o.header.englishComment,
    vertices: o.vertices.map(vertex),
    indices: Array.from(o.indices),
    textures: [...o.textures],
    materials: o.materials.map(material),
    bones: o.bones.map(bone),
    morphs: o.morphs.map(morph),
    frames: o.displayFrames.map((f) => ({
      name: f.name,
      nameEn: f.englishName,
      special: f.isSpecialFrame,
      items: f.frames.map((it) => ({
        kind: it.type === 0 ? ('bone' as const) : ('morph' as const),
        index: it.index,
      })),
    })),
    rigidBodies: o.rigidBodies.map((r) => ({
      name: r.name,
      nameEn: r.englishName,
      bone: r.boneIndex,
      group: r.collisionGroup,
      collidesWith: ~r.collisionMask & 0xffff,
      shape: r.shapeType as 0 | 1 | 2,
      size: v3(r.shapeSize),
      position: v3(r.shapePosition),
      rotation: v3(r.shapeRotation),
      mass: r.mass,
      linearDamping: r.linearDamping,
      angularDamping: r.angularDamping,
      restitution: r.repulsion,
      friction: r.friction,
      mode: r.physicsMode as 0 | 1 | 2,
    })),
    joints: o.joints.map((j) => ({
      name: j.name,
      nameEn: j.englishName,
      a: j.rigidbodyIndexA,
      b: j.rigidbodyIndexB,
      position: v3(j.position),
      rotation: v3(j.rotation),
      moveMin: v3(j.positionMin),
      moveMax: v3(j.positionMax),
      rotateMin: v3(j.rotationMin),
      rotateMax: v3(j.rotationMax),
      springMove: v3(j.springPosition),
      springRotate: v3(j.springRotation),
    })),
  };
}

/** Parse PMX bytes into a PmxModel. */
export async function readPmx(bytes: ArrayBuffer | Uint8Array): Promise<PmxModel> {
  // ArrayBuffer.isView also catches Node Buffers from another realm (tests).
  const buf = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice().buffer
    : bytes;
  return fromPmxObject(await PmxReader.ParseAsync(buf as ArrayBuffer));
}

/** Deep copy (structuredClone keeps typed arrays). */
export const cloneModel = (m: PmxModel): PmxModel => structuredClone(m);
