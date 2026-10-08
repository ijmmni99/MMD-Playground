// FBX → SourceModel via three's FBXLoader (parse only — nothing is rendered).
//
// Why FBXLoader: there is no maintained ufbx WebAssembly package on npm, while FBXLoader is widely used,
// parses binary (7.x) and ASCII FBX with skins, blend shapes, multi-materials and embedded media, and
// runs in a worker once its texture loading is intercepted (we only need the bytes, not GPU textures).

import {
  Bone,
  BufferGeometry,
  Loader,
  LoadingManager,
  Material,
  Matrix4,
  Mesh,
  MeshPhongMaterial,
  Object3D,
  SkinnedMesh,
  Texture,
  Vector3,
  type Group,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { SourceBone, SourceMaterial, SourceMesh, SourceModel, SourceTexture, Vec3 } from './types';

/** Texture "loader" that records the requested URL instead of decoding an image. */
class UrlRecorder extends Loader {
  override load(url: string): Texture {
    const t = new Texture();
    t.userData.src = url;
    t.name = url;
    return t;
  }
}

async function fetchBytes(url: string): Promise<Uint8Array | undefined> {
  try {
    if (url.startsWith('data:')) {
      const b64 = url.slice(url.indexOf(',') + 1);
      return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    }
    const res = await fetch(url);
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

const mimeOf = (name: string): string =>
  /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.tga$/i.test(name) ? 'image/tga' : /\.bmp$/i.test(name) ? 'image/bmp' : /\.webp$/i.test(name) ? 'image/webp' : 'image/png';

export async function parseFbx(
  buffer: ArrayBuffer,
  resolve: (name: string) => Uint8Array | undefined = () => undefined,
  fileName = 'model.fbx',
): Promise<SourceModel> {
  const g = globalThis as unknown as { window?: unknown };
  // FBXLoader calls window.URL.createObjectURL for embedded media; a worker has no `window`.
  if (typeof g.window === 'undefined') g.window = globalThis;
  const warnings: string[] = [];
  const manager = new LoadingManager();
  const recorder = new UrlRecorder(manager);
  manager.addHandler(/\.(png|jpe?g|tga|bmp|tiff?|webp|dds|psd|gif)$/i, recorder);
  const loader = new FBXLoader(manager);
  const originalWarn = console.warn;
  let root: Group;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' ').replace(/^THREE\.\s*/, ''));
  try {
    root = loader.parse(buffer, '');
  } finally {
    console.warn = originalWarn;
  }
  root.updateMatrixWorld(true);

  // Bones: every Bone, plus non-mesh ancestors of skinned skeleton bones.
  const boneObjs: Object3D[] = [];
  const boneIndex = new Map<Object3D, number>();
  const addBone = (o: Object3D): void => {
    if (boneIndex.has(o)) return;
    boneIndex.set(o, boneObjs.length);
    boneObjs.push(o);
  };
  root.traverse((o) => {
    if ((o as Bone).isBone) addBone(o);
  });
  root.traverse((o) => {
    const sm = o as SkinnedMesh;
    if (sm.isSkinnedMesh) for (const b of sm.skeleton.bones) addBone(b);
  });
  if (!boneObjs.length) addBone(root);
  // Parent-first order.
  const depth = (o: Object3D): number => {
    let d = 0;
    for (let p = o.parent; p; p = p.parent) d++;
    return d;
  };
  boneObjs.sort((a, b) => depth(a) - depth(b));
  boneIndex.clear();
  boneObjs.forEach((o, i) => boneIndex.set(o, i));
  const v = new Vector3();
  const bones: SourceBone[] = boneObjs.map((o) => {
    let p = o.parent;
    while (p && !boneIndex.has(p)) p = p.parent;
    o.getWorldPosition(v);
    return { name: o.name || `bone${boneIndex.get(o)}`, parent: p ? boneIndex.get(p)! : -1, position: [v.x, v.y, v.z] };
  });
  const nearestBone = (o: Object3D): number => {
    for (let p: Object3D | null = o; p; p = p.parent) if (boneIndex.has(p)) return boneIndex.get(p)!;
    return 0;
  };

  // Materials and textures.
  const materials: SourceMaterial[] = [];
  const materialIndex = new Map<Material, number>();
  const textures: SourceTexture[] = [];
  const textureIndex = new Map<string, number>();
  const pending: Promise<void>[] = [];
  const texture = (t: Texture | null | undefined): number => {
    const src = t?.userData?.src as string | undefined;
    if (!src) return -1;
    if (textureIndex.has(src)) return textureIndex.get(src)!;
    const idx = textures.length;
    const name = src.startsWith('blob:') || src.startsWith('data:') ? `${t!.name && !t!.name.startsWith('blob:') ? t!.name : `texture${idx}`}` : src.split(/[\\/]/).pop()!;
    textures.push({ name, mime: mimeOf(name), data: new Uint8Array() });
    textureIndex.set(src, idx);
    pending.push(
      (async () => {
        let data: Uint8Array | undefined;
        if (src.startsWith('blob:') || src.startsWith('data:')) data = await fetchBytes(src);
        else data = resolve(src) ?? resolve(src.split(/[\\/]/).pop()!);
        if (data?.length) textures[idx].data = data;
        else warnings.push(`Texture ${name} is missing`);
        if (src.startsWith('blob:')) URL.revokeObjectURL(src);
      })(),
    );
    return idx;
  };
  const material = (m: Material): number => {
    if (materialIndex.has(m)) return materialIndex.get(m)!;
    const p = m as MeshPhongMaterial;
    const color = p.color ?? { r: 1, g: 1, b: 1 };
    const out: SourceMaterial = {
      name: m.name || `material${materials.length}`,
      color: [color.r, color.g, color.b, m.opacity ?? 1],
      texture: texture(p.map),
      alphaMode: m.transparent || (m.opacity ?? 1) < 1 ? 'blend' : p.alphaMap ? 'mask' : 'opaque',
      alphaCutoff: 0.5,
      doubleSided: m.side === 2,
      emissive: p.emissive ? [p.emissive.r, p.emissive.g, p.emissive.b] : [0, 0, 0],
      unlit: false,
    };
    materials.push(out);
    materialIndex.set(m, materials.length - 1);
    return materials.length - 1;
  };

  // Meshes, skinned into their rest pose in world space.
  const meshes: SourceMesh[] = [];
  const tmp = new Matrix4();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry as BufferGeometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const n = pos.count;
    const nrm = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    const skinned = (mesh as SkinnedMesh).isSkinnedMesh ? (mesh as SkinnedMesh) : null;
    const si = geo.getAttribute('skinIndex');
    const sw = geo.getAttribute('skinWeight');
    let boneMats: Matrix4[] | undefined;
    let boneMap: number[] | undefined;
    let pre: Matrix4 | undefined;
    let post: Matrix4 | undefined;
    if (skinned && si && sw) {
      const sk = skinned.skeleton;
      boneMats = sk.bones.map((b, i) => new Matrix4().multiplyMatrices(b.matrixWorld, sk.boneInverses[i]));
      boneMap = sk.bones.map((b) => boneIndex.get(b) ?? nearestBone(b));
      // world = meshWorld · bindMatrixInverse · Σ wᵢ Bᵢ · bindMatrix · v  (three's attached bind mode)
      pre = skinned.bindMatrix.clone();
      post = new Matrix4().multiplyMatrices(skinned.matrixWorld, skinned.bindMatrixInverse);
    }
    const rigid = nearestBone(mesh);
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    const joints = new Uint16Array(n * 4);
    const weights = new Float32Array(n * 4);
    const perVertex: Matrix4[] = new Array(n);
    const blended = new Matrix4();
    for (let i = 0; i < n; i++) {
      let m4: Matrix4 = mesh.matrixWorld;
      if (boneMats && boneMap && si && sw && pre && post) {
        const e = blended.elements.fill(0);
        let total = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i, k);
          if (!(w > 0)) continue;
          const bi = si.getComponent(i, k);
          const be = boneMats[bi]?.elements;
          if (!be) continue;
          for (let q = 0; q < 16; q++) e[q] += be[q] * w;
          joints[i * 4 + k] = boneMap[bi];
          weights[i * 4 + k] = w;
          total += w;
        }
        if (total > 0) {
          for (let q = 0; q < 16; q++) e[q] /= total;
          for (let k = 0; k < 4; k++) weights[i * 4 + k] /= total;
          m4 = tmp.multiplyMatrices(post, blended).multiply(pre).clone();
        } else {
          joints[i * 4] = rigid;
          weights[i * 4] = 1;
        }
      } else {
        joints[i * 4] = rigid;
        weights[i * 4] = 1;
      }
      perVertex[i] = m4;
      v.fromBufferAttribute(pos, i).applyMatrix4(m4);
      positions.set([v.x, v.y, v.z], i * 3);
      if (nrm) {
        v.fromBufferAttribute(nrm, i).transformDirection(m4);
        normals.set([v.x, v.y, v.z], i * 3);
      }
      if (uv) {
        // three flips V on load (flipY); glTF / PMX keep the top-left origin.
        uvs[i * 2] = uv.getX(i);
        uvs[i * 2 + 1] = 1 - uv.getY(i);
      }
    }
    const morphAttrs = geo.morphAttributes.position ?? [];
    const dict = mesh.morphTargetDictionary ?? {};
    const names = Object.entries(dict).sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const morphs = morphAttrs.map((attr, k) => {
      const deltas = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(attr, i);
        if (!geo.morphTargetsRelative) v.sub(new Vector3().fromBufferAttribute(pos, i));
        const e = perVertex[i].elements;
        deltas[i * 3] = e[0] * v.x + e[4] * v.y + e[8] * v.z;
        deltas[i * 3 + 1] = e[1] * v.x + e[5] * v.y + e[9] * v.z;
        deltas[i * 3 + 2] = e[2] * v.x + e[6] * v.y + e[10] * v.z;
      }
      return { name: names[k] ?? attr.name ?? `morph${k}`, deltas };
    });
    const index = geo.index ? Uint32Array.from(geo.index.array as ArrayLike<number>) : Uint32Array.from({ length: n }, (_, i) => i);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: index.length, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0] ?? mats[0];
      const idx = index.subarray(grp.start, grp.start + Math.min(grp.count, index.length - grp.start));
      const tri = idx.subarray(0, idx.length - (idx.length % 3));
      // Compact: only the vertices this material group uses.
      const remap = new Map<number, number>();
      for (const i of tri) if (!remap.has(i)) remap.set(i, remap.size);
      const used = [...remap.keys()];
      const pick = (src: Float32Array, k: number): Float32Array => {
        const out = new Float32Array(used.length * k);
        used.forEach((i, j) => out.set(src.subarray(i * k, i * k + k), j * k));
        return out;
      };
      const pickJ = new Uint16Array(used.length * 4);
      used.forEach((i, j) => pickJ.set(joints.subarray(i * 4, i * 4 + 4), j * 4));
      meshes.push({
        name: mesh.name || `mesh${meshes.length}`,
        positions: pick(positions, 3),
        normals: pick(normals, 3),
        uvs: pick(uvs, 2),
        indices: Uint32Array.from(tri, (i) => remap.get(i)!),
        joints: pickJ,
        weights: pick(weights, 4),
        material: mat ? material(mat) : -1,
        morphs: morphs.map((mo) => ({ name: mo.name, deltas: pick(mo.deltas, 3) })),
      });
    }
  });
  await Promise.all(pending);
  if (meshes.some((m) => m.material < 0)) {
    materials.push({ name: 'default', color: [0.8, 0.8, 0.8, 1], texture: -1, alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false, emissive: [0, 0, 0], unlit: false });
    for (const m of meshes) if (m.material < 0) m.material = materials.length - 1;
  }
  return {
    name: root.name && root.name !== 'Scene' ? root.name : fileName.replace(/\.[^.]+$/, ''),
    format: 'fbx',
    bones,
    meshes,
    materials,
    textures,
    warnings: [...new Set(warnings)].slice(0, 20),
  };
}

export type { Vec3 };
