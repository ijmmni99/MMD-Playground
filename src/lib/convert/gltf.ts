// glTF 2.0 / GLB / VRM (0.x and 1.0) → SourceModel. Pure: takes bytes plus a resolver for external
// files (ZIP contents), so it runs in a worker and in Node tests.

import { compose, fromArray, identity, invert, multiply, transformDir, transformPoint, type Mat4 } from './mat4';
import type {
  HumanSlot,
  SourceBone,
  SourceExpression,
  SourceLicense,
  SourceMaterial,
  SourceMesh,
  SourceModel,
  SourceTexture,
  SpringChain,
  SpringCollider,
  Vec3,
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export type ExternalResolver = (uri: string) => Uint8Array | undefined;

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** Split a GLB into its JSON and binary chunks. */
export function parseGlb(bytes: Uint8Array): { json: Json; bin?: Uint8Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  const length = dv.getUint32(8, true);
  let o = 12;
  let json: Json;
  let bin: Uint8Array | undefined;
  while (o + 8 <= length) {
    const len = dv.getUint32(o, true);
    const type = dv.getUint32(o + 4, true);
    const chunk = bytes.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    o += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

export const isGlb = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;

function dataUri(uri: string): Uint8Array | undefined {
  const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(uri);
  if (!m) return undefined;
  if (!m[1]) return new TextEncoder().encode(decodeURIComponent(m[2]));
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class Reader {
  private buffers: Uint8Array[] = [];
  constructor(
    private readonly json: Json,
    bin: Uint8Array | undefined,
    resolve: ExternalResolver,
    warnings: string[],
  ) {
    for (const [i, b] of (json.buffers ?? []).entries()) {
      let data: Uint8Array | undefined;
      if (b.uri === undefined) data = i === 0 ? bin : undefined;
      else data = dataUri(b.uri) ?? resolve(decodeURIComponent(b.uri));
      if (!data) {
        warnings.push(`Buffer ${b.uri ?? i} is missing`);
        data = new Uint8Array(b.byteLength ?? 0);
      }
      this.buffers.push(data);
    }
  }

  view(index: number): { bytes: Uint8Array; stride?: number } {
    const v = this.json.bufferViews[index];
    const buf = this.buffers[v.buffer];
    return { bytes: buf.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), stride: v.byteStride };
  }

  /** Accessor as a flat Float32Array (normalized integers scaled), or as raw integers when `int`. */
  accessor(index: number, int = false): Float32Array | Uint32Array {
    const a = this.json.accessors[index];
    const n = COMPONENTS[a.type];
    const out = int ? new Uint32Array(a.count * n) : new Float32Array(a.count * n);
    const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType as number] ?? 4;
    const read = (dv: DataView, off: number): number => {
      switch (a.componentType) {
        case 5120: {
          const v = dv.getInt8(off);
          return a.normalized && !int ? Math.max(v / 127, -1) : v;
        }
        case 5121: {
          const v = dv.getUint8(off);
          return a.normalized && !int ? v / 255 : v;
        }
        case 5122: {
          const v = dv.getInt16(off, true);
          return a.normalized && !int ? Math.max(v / 32767, -1) : v;
        }
        case 5123: {
          const v = dv.getUint16(off, true);
          return a.normalized && !int ? v / 65535 : v;
        }
        case 5125:
          return dv.getUint32(off, true);
        default:
          return dv.getFloat32(off, true);
      }
    };
    if (a.bufferView !== undefined) {
      const { bytes, stride } = this.view(a.bufferView);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const elem = stride ?? size * n;
      const base = a.byteOffset ?? 0;
      for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = read(dv, base + i * elem + c * size);
    }
    if (a.sparse) {
      const s = a.sparse;
      const iv = this.view(s.indices.bufferView);
      const idv = new DataView(iv.bytes.buffer, iv.bytes.byteOffset + (s.indices.byteOffset ?? 0));
      const vv = this.view(s.values.bufferView);
      const vdv = new DataView(vv.bytes.buffer, vv.bytes.byteOffset + (s.values.byteOffset ?? 0));
      const isz = { 5121: 1, 5123: 2, 5125: 4 }[s.indices.componentType as number] ?? 4;
      for (let i = 0; i < s.count; i++) {
        const target = isz === 1 ? idv.getUint8(i) : isz === 2 ? idv.getUint16(i * 2, true) : idv.getUint32(i * 4, true);
        for (let c = 0; c < n; c++) out[target * n + c] = read(vdv, (i * n + c) * size);
      }
    }
    return out;
  }
}

const VRM0_SLOTS: Record<string, HumanSlot> = {
  leftThumbProximal: 'leftThumbMetacarpal',
  leftThumbIntermediate: 'leftThumbProximal',
  rightThumbProximal: 'rightThumbMetacarpal',
  rightThumbIntermediate: 'rightThumbProximal',
};

/** VRM 0.x blend shape preset → VRM 1.0 expression preset. */
const VRM0_PRESETS: Record<string, string> = {
  a: 'aa',
  i: 'ih',
  u: 'ou',
  e: 'ee',
  o: 'oh',
  blink: 'blink',
  blink_l: 'blinkLeft',
  blink_r: 'blinkRight',
  joy: 'happy',
  angry: 'angry',
  sorrow: 'sad',
  fun: 'relaxed',
  lookup: 'lookUp',
  lookdown: 'lookDown',
  lookleft: 'lookLeft',
  lookright: 'lookRight',
  neutral: 'neutral',
};

export function parseGltf(input: Uint8Array, resolve: ExternalResolver = () => undefined, fileName = 'model'): SourceModel {
  const warnings: string[] = [];
  const { json, bin } = isGlb(input) ? parseGlb(input) : { json: JSON.parse(new TextDecoder().decode(input)), bin: undefined };
  const r = new Reader(json, bin, resolve, warnings);
  const nodes: Json[] = json.nodes ?? [];
  const ext = json.extensions ?? {};
  const vrm0 = ext.VRM;
  const vrm1 = ext.VRMC_vrm;

  // Node world matrices (rest pose).
  const parentOf = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c: number) => (parentOf[c] = i)));
  const local = nodes.map((n) =>
    n.matrix ? fromArray(n.matrix) : compose(n.translation ?? [0, 0, 0], n.rotation ?? [0, 0, 0, 1], n.scale ?? [1, 1, 1]),
  );
  const world: (Mat4 | undefined)[] = new Array(nodes.length);
  const worldOf = (i: number): Mat4 => {
    if (world[i]) return world[i]!;
    const w = parentOf[i] >= 0 ? multiply(worldOf(parentOf[i]), local[i]) : local[i];
    world[i] = w;
    return w;
  };

  // Bones: skin joints, their ancestors, humanoid and spring nodes; else all non-mesh nodes.
  const isBone = new Set<number>();
  const addWithAncestors = (i: number): void => {
    for (let n = i; n >= 0 && !isBone.has(n); n = parentOf[n]) isBone.add(n);
  };
  for (const s of json.skins ?? []) for (const j of s.joints) addWithAncestors(j);
  const humanNodes: [string, number][] = vrm1
    ? Object.entries(vrm1.humanoid?.humanBones ?? {}).map(([k, v]: [string, Json]) => [k, v.node])
    : vrm0
      ? (vrm0.humanoid?.humanBones ?? []).map((b: Json) => [b.bone, b.node])
      : [];
  for (const [, n] of humanNodes) if (n >= 0 && n < nodes.length) addWithAncestors(n);
  if (!isBone.size) nodes.forEach((n, i) => n.mesh === undefined && addWithAncestors(i));
  // A node that only carries a mesh at the scene root isn't a bone.
  const boneNodes = [...isBone].sort((a, b) => a - b);
  const boneIndex = new Map<number, number>();
  boneNodes.forEach((n, i) => boneIndex.set(n, i));
  const bones: SourceBone[] = boneNodes.map((n, i) => {
    const p = transformPoint(worldOf(n), 0, 0, 0);
    let par = parentOf[n];
    while (par >= 0 && !boneIndex.has(par)) par = parentOf[par];
    return { name: nodes[n].name ?? `bone${i}`, parent: par >= 0 ? boneIndex.get(par)! : -1, position: p };
  });
  if (!bones.length) bones.push({ name: 'root', parent: -1, position: [0, 0, 0] });
  /** Nearest bone for a (mesh) node: itself or an ancestor. */
  const boneFor = (node: number): number => {
    for (let n = node; n >= 0; n = parentOf[n]) if (boneIndex.has(n)) return boneIndex.get(n)!;
    return 0;
  };

  // Materials and textures.
  const textures: SourceTexture[] = [];
  const textureFor = new Map<number, number>();
  const texture = (texIndex: number | undefined): number => {
    if (texIndex === undefined) return -1;
    if (textureFor.has(texIndex)) return textureFor.get(texIndex)!;
    const t = json.textures?.[texIndex];
    const imgIndex = t?.source ?? t?.extensions?.KHR_texture_basisu?.source;
    const img = json.images?.[imgIndex];
    let data: Uint8Array | undefined;
    let mime = img?.mimeType ?? '';
    let name = img?.name || `texture${texIndex}`;
    if (img?.bufferView !== undefined) data = r.view(img.bufferView).bytes.slice();
    else if (img?.uri) {
      data = dataUri(img.uri) ?? resolve(decodeURIComponent(img.uri));
      name = img.name || decodeURIComponent(img.uri).split('/').pop()!;
    }
    if (!mime) mime = /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/png';
    if (!data) {
      warnings.push(`Texture ${name} is missing`);
      textureFor.set(texIndex, -1);
      return -1;
    }
    textures.push({ name, mime, data });
    textureFor.set(texIndex, textures.length - 1);
    return textures.length - 1;
  };
  const vrm0Props: Json[] = vrm0?.materialProperties ?? [];
  const materials: SourceMaterial[] = (json.materials ?? []).map((m: Json, i: number) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const mtoon1 = m.extensions?.VRMC_materials_mtoon;
    const mtoon0 = vrm0Props.find((p) => p.name === m.name && /mtoon/i.test(p.shader ?? ''));
    const color = (pbr.baseColorFactor ?? [1, 1, 1, 1]) as [number, number, number, number];
    const out: SourceMaterial = {
      name: m.name ?? `material${i}`,
      color: [...color] as [number, number, number, number],
      texture: texture(pbr.baseColorTexture?.index),
      alphaMode: m.alphaMode === 'BLEND' ? 'blend' : m.alphaMode === 'MASK' ? 'mask' : 'opaque',
      alphaCutoff: m.alphaCutoff ?? 0.5,
      doubleSided: !!m.doubleSided,
      emissive: (m.emissiveFactor ?? [0, 0, 0]) as Vec3,
      unlit: !!m.extensions?.KHR_materials_unlit,
    };
    if (mtoon1)
      out.mtoon = {
        shade: (mtoon1.shadeColorFactor ?? [0.7, 0.7, 0.7]) as Vec3,
        outlineWidth: mtoon1.outlineWidthMode === 'none' ? 0 : (mtoon1.outlineWidthFactor ?? 0),
        outlineColor: (mtoon1.outlineColorFactor ?? [0, 0, 0]) as Vec3,
      };
    else if (mtoon0) {
      const v = mtoon0.vectorProperties ?? {};
      const f = mtoon0.floatProperties ?? {};
      out.mtoon = {
        shade: ((v._ShadeColor ?? [0.7, 0.7, 0.7]) as number[]).slice(0, 3) as Vec3,
        // VRM 0 outline width is in centimetres-ish screen units; keep the factor relative.
        outlineWidth: f._OutlineWidthMode === 0 ? 0 : (f._OutlineWidth ?? 0) * 0.01,
        outlineColor: ((v._OutlineColor ?? [0, 0, 0]) as number[]).slice(0, 3) as Vec3,
      };
      if (v._Color && !pbr.baseColorFactor) out.color = [...(v._Color as number[])] as [number, number, number, number];
    }
    return out;
  });

  // Meshes (every node instance, skinned or rigid), baked into world space.
  const meshes: SourceMesh[] = [];
  nodes.forEach((node, ni) => {
    if (node.mesh === undefined) return;
    const mesh = json.meshes[node.mesh];
    const skin = node.skin !== undefined ? json.skins[node.skin] : undefined;
    let skinMats: Mat4[] | undefined;
    let skinJoints: number[] | undefined;
    if (skin) {
      const ibm = skin.inverseBindMatrices !== undefined ? (r.accessor(skin.inverseBindMatrices) as Float32Array) : undefined;
      skinJoints = skin.joints.map((j: number) => boneIndex.get(j) ?? 0);
      skinMats = skin.joints.map((j: number, k: number) => multiply(worldOf(j), ibm ? fromArray(ibm, k * 16) : identity()));
    }
    const nodeWorld = worldOf(ni);
    const rigidBone = boneFor(ni);
    const targetNames: string[] = mesh.extras?.targetNames ?? mesh.primitives?.[0]?.extras?.targetNames ?? [];
    (mesh.primitives ?? []).forEach((prim: Json, pi: number) => {
      const mode = prim.mode ?? 4;
      if (mode !== 4 && mode !== 5 && mode !== 6) {
        warnings.push(`Mesh ${mesh.name ?? node.mesh}: primitive mode ${mode} skipped`);
        return;
      }
      const a = prim.attributes;
      if (a.POSITION === undefined) return;
      const pos = r.accessor(a.POSITION) as Float32Array;
      const n = pos.length / 3;
      const nrm = a.NORMAL !== undefined ? (r.accessor(a.NORMAL) as Float32Array) : new Float32Array(n * 3);
      const uv = a.TEXCOORD_0 !== undefined ? (r.accessor(a.TEXCOORD_0) as Float32Array) : new Float32Array(n * 2);
      const jRaw = a.JOINTS_0 !== undefined ? (r.accessor(a.JOINTS_0, true) as Uint32Array) : undefined;
      const wRaw = a.WEIGHTS_0 !== undefined ? (r.accessor(a.WEIGHTS_0) as Float32Array) : undefined;
      let idx: Uint32Array;
      if (prim.indices !== undefined) idx = r.accessor(prim.indices, true) as Uint32Array;
      else idx = Uint32Array.from({ length: n }, (_, i) => i);
      idx = triangulate(idx, mode);

      const positions = new Float32Array(n * 3);
      const normals = new Float32Array(n * 3);
      const joints = new Uint16Array(n * 4);
      const weights = new Float32Array(n * 4);
      const vertexMats: (Mat4 | null)[] = new Array(n).fill(null);
      for (let v = 0; v < n; v++) {
        let m: Mat4 = nodeWorld;
        if (skinMats && jRaw && wRaw) {
          // Blend the skinning matrices (exact for positions, close enough for normals).
          m = new Float64Array(16);
          let sw = 0;
          for (let k = 0; k < 4; k++) {
            const w = wRaw[v * 4 + k];
            if (!(w > 0)) continue;
            const sm = skinMats[jRaw[v * 4 + k]] ?? identity();
            for (let e = 0; e < 16; e++) m[e] += sm[e] * w;
            sw += w;
            joints[v * 4 + k] = skinJoints![jRaw[v * 4 + k]] ?? 0;
            weights[v * 4 + k] = w;
          }
          if (sw <= 0) {
            m = nodeWorld;
            joints[v * 4] = rigidBone;
            weights[v * 4] = 1;
          } else {
            for (let e = 0; e < 16; e++) m[e] /= sw;
            for (let k = 0; k < 4; k++) weights[v * 4 + k] /= sw;
          }
        } else {
          joints[v * 4] = rigidBone;
          weights[v * 4] = 1;
        }
        vertexMats[v] = m;
        const p = transformPoint(m, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        positions.set(p, v * 3);
        const d = transformDir(m, nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
        const l = Math.hypot(...d) || 1;
        normals.set([d[0] / l, d[1] / l, d[2] / l], v * 3);
      }
      const morphs = (prim.targets ?? []).map((t: Json, ti: number) => {
        const deltas = new Float32Array(n * 3);
        if (t.POSITION !== undefined) {
          const d = r.accessor(t.POSITION) as Float32Array;
          for (let v = 0; v < n; v++) {
            const m = vertexMats[v]!;
            deltas.set(transformDir(m, d[v * 3], d[v * 3 + 1], d[v * 3 + 2]), v * 3);
          }
        }
        return { name: targetNames[ti] ?? `morph${ti}`, deltas };
      });
      meshes.push({
        name: `${mesh.name ?? `mesh${node.mesh}`}${mesh.primitives.length > 1 ? `_${pi}` : ''}`,
        positions,
        normals,
        uvs: uv.slice(0, n * 2) as Float32Array,
        indices: idx,
        joints,
        weights,
        material: prim.material ?? -1,
        morphs,
        meshIndex: node.mesh,
        nodeIndex: ni,
      });
    });
  });
  if (meshes.some((m) => m.material < 0)) {
    const def = materials.length;
    materials.push({ name: 'default', color: [0.8, 0.8, 0.8, 1], texture: -1, alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false, emissive: [0, 0, 0], unlit: false });
    for (const m of meshes) if (m.material < 0) m.material = def;
  }

  // VRM humanoid.
  let humanoid: Partial<Record<HumanSlot, number>> | undefined;
  if (humanNodes.length) {
    humanoid = {};
    for (const [k, n] of humanNodes) {
      const slot = (vrm0 ? (VRM0_SLOTS[k] ?? k) : k) as HumanSlot;
      if (boneIndex.has(n)) humanoid[slot] = boneIndex.get(n)!;
    }
  }

  // Expressions.
  let expressions: SourceExpression[] | undefined;
  const meshByNode = (node: number): number => nodes[node]?.mesh ?? -1;
  if (vrm1?.expressions) {
    expressions = [];
    const groups: [string, Json, boolean][] = [
      ...Object.entries(vrm1.expressions.preset ?? {}).map(([k, v]) => [k, v, true] as [string, Json, boolean]),
      ...Object.entries(vrm1.expressions.custom ?? {}).map(([k, v]) => [k, v, false] as [string, Json, boolean]),
    ];
    for (const [name, e, preset] of groups)
      expressions.push({
        name,
        preset: preset ? name : undefined,
        binds: (e.morphTargetBinds ?? []).map((b: Json) => ({ mesh: meshByNode(b.node), morph: b.index, weight: b.weight ?? 1 })),
      });
  } else if (vrm0?.blendShapeMaster) {
    expressions = (vrm0.blendShapeMaster.blendShapeGroups ?? []).map((g: Json) => ({
      name: g.name,
      preset: g.presetName && g.presetName !== 'unknown' ? (VRM0_PRESETS[g.presetName.toLowerCase()] ?? g.presetName) : undefined,
      binds: (g.binds ?? []).map((b: Json) => ({ mesh: b.mesh, morph: b.index, weight: (b.weight ?? 100) / 100 })),
    }));
  }

  // Spring bones.
  let springs: SourceModel['springs'];
  if (ext.VRMC_springBone) {
    const sb = ext.VRMC_springBone;
    const colliders: SpringCollider[] = (sb.colliders ?? []).map((c: Json) => {
      const s = c.shape?.sphere ?? c.shape?.capsule ?? {};
      return { bone: boneIndex.get(c.node) ?? 0, offset: (s.offset ?? [0, 0, 0]) as Vec3, radius: s.radius ?? 0.05, tail: c.shape?.capsule?.tail };
    });
    const groupCols: number[][] = (sb.colliderGroups ?? []).map((g: Json) => g.colliders ?? []);
    const chains: SpringChain[] = (sb.springs ?? []).map((s: Json, i: number) => ({
      name: s.name ?? `spring${i}`,
      joints: (s.joints ?? [])
        .filter((j: Json) => boneIndex.has(j.node))
        .map((j: Json) => ({
          bone: boneIndex.get(j.node)!,
          radius: j.hitRadius ?? 0.02,
          stiffness: j.stiffness ?? 1,
          drag: j.dragForce ?? 0.4,
          gravity: j.gravityPower ?? 0,
        })),
      colliders: (s.colliderGroups ?? []).flatMap((g: number) => groupCols[g] ?? []),
    }));
    springs = { chains, colliders };
  } else if (vrm0?.secondaryAnimation) {
    const sa = vrm0.secondaryAnimation;
    const colliders: SpringCollider[] = [];
    const groupCols: number[][] = (sa.colliderGroups ?? []).map((g: Json) =>
      (g.colliders ?? []).map((c: Json) => {
        colliders.push({ bone: boneIndex.get(g.node) ?? 0, offset: [c.offset?.x ?? 0, c.offset?.y ?? 0, c.offset?.z ?? 0], radius: c.radius ?? 0.05 });
        return colliders.length - 1;
      }),
    );
    // VRM 0 groups list root bones; the chain is each root's descendants.
    const childrenOf = new Map<number, number[]>();
    bones.forEach((b, i) => b.parent >= 0 && childrenOf.set(b.parent, [...(childrenOf.get(b.parent) ?? []), i]));
    const chains: SpringChain[] = [];
    for (const [gi, g] of (sa.boneGroups ?? []).entries()) {
      for (const root of g.bones ?? []) {
        if (!boneIndex.has(root)) continue;
        const list: number[] = [];
        const walk = (b: number): void => {
          list.push(b);
          for (const c of childrenOf.get(b) ?? []) walk(c);
        };
        walk(boneIndex.get(root)!);
        chains.push({
          name: g.comment || `group${gi}`,
          joints: list.map((b) => ({ bone: b, radius: g.hitRadius ?? 0.02, stiffness: g.stiffiness ?? 1, drag: g.dragForce ?? 0.4, gravity: g.gravityPower ?? 0 })),
          colliders: (g.colliderGroups ?? []).flatMap((c: number) => groupCols[c] ?? []),
        });
      }
    }
    springs = { chains, colliders };
  }

  // License metadata.
  let license: SourceLicense | undefined;
  if (vrm1?.meta) {
    const m = vrm1.meta;
    license = {
      title: m.name,
      author: (m.authors ?? []).join(', '),
      version: m.version,
      allowedUsers: m.avatarPermission,
      commercial: m.commercialUsage,
      redistribution: m.allowRedistribution === undefined ? undefined : m.allowRedistribution ? 'allowed' : 'not allowed',
      modification: m.modification,
      violence: m.allowExcessivelyViolentUsage === undefined ? undefined : m.allowExcessivelyViolentUsage ? 'allowed' : 'not allowed',
      sexual: m.allowExcessivelySexualUsage === undefined ? undefined : m.allowExcessivelySexualUsage ? 'allowed' : 'not allowed',
      licenseName: 'VRM Public License 1.0',
      url: m.licenseUrl,
      otherUrl: m.otherLicenseUrl,
    };
  } else if (vrm0?.meta) {
    const m = vrm0.meta;
    license = {
      title: m.title,
      author: m.author,
      version: m.version,
      allowedUsers: m.allowedUserName,
      commercial: m.commercialUssageName,
      violence: m.violentUssageName,
      sexual: m.sexualUssageName,
      licenseName: m.licenseName,
      url: m.otherLicenseUrl,
      otherUrl: m.otherPermissionUrl,
      text: m.reference,
    };
  } else if (json.asset?.copyright) license = { text: json.asset.copyright };

  const name = vrm1?.meta?.name || vrm0?.meta?.title || json.scenes?.[json.scene ?? 0]?.name || fileName.replace(/\.[^.]+$/, '');
  return {
    name,
    format: vrm1 ? 'vrm1' : vrm0 ? 'vrm0' : isGlb(input) ? 'glb' : 'gltf',
    bones,
    meshes,
    materials,
    textures,
    humanoid,
    expressions,
    springs,
    license,
    warnings,
  };
}

/** Strips / fans → triangle lists. */
function triangulate(idx: Uint32Array, mode: number): Uint32Array {
  if (mode === 4) return idx.length % 3 ? idx.subarray(0, idx.length - (idx.length % 3)) : idx;
  const out: number[] = [];
  for (let i = 2; i < idx.length; i++) {
    if (mode === 5) {
      if (i % 2) out.push(idx[i - 1], idx[i - 2], idx[i]);
      else out.push(idx[i - 2], idx[i - 1], idx[i]);
    } else out.push(idx[0], idx[i - 1], idx[i]);
  }
  return Uint32Array.from(out);
}

export { invert };
