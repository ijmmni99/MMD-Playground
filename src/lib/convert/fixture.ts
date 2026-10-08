// Procedural test humanoid written as glTF/GLB/VRM (original, public-domain geometry; no assets).
// Used by unit tests, e2e fixtures and the "Try a sample" button.
//
// glTF space: metres, +Y up, facing +Z, model's left at +X. 1.6 m tall, T-pose by default.

import type { Vec3 } from './types';

export type FixtureStyle = 'mixamo' | 'vrm' | 'blender' | 'scrambled';

export interface FixtureOptions {
  style?: FixtureStyle;
  /** Add VRM extensions (0 or 1). */
  vrm?: 0 | 1;
  /** Arm angle below horizontal, degrees (0 = T-pose). */
  armDown?: number;
  /** Scale of the scene (e.g. 100 for a centimetre FBX-style rig). */
  scale?: number;
  /** Rotate the whole model 180° about Y (VRM 0.x style facing −Z). */
  facingBack?: boolean;
  /** Hair and skirt chains. */
  secondary?: boolean;
  name?: string;
}

interface BoneDef {
  key: string;
  parent: string | null;
  pos: Vec3;
}

const SIDES = [
  ['L', 1],
  ['R', -1],
] as const;

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;

/** Canonical skeleton (keys are VRM 1.0 humanoid names where they exist). */
function skeleton(armDown: number, secondary: boolean): BoneDef[] {
  const b: BoneDef[] = [];
  const add = (key: string, parent: string | null, pos: Vec3): void => void b.push({ key, parent, pos });
  add('hips', null, [0, 0.95, 0]);
  add('spine', 'hips', [0, 1.05, 0]);
  add('chest', 'spine', [0, 1.22, 0]);
  add('neck', 'chest', [0, 1.42, 0]);
  add('head', 'neck', [0, 1.5, 0]);
  add('headEnd', 'head', [0, 1.72, 0]);
  const a = (armDown * Math.PI) / 180;
  for (const [s, k] of SIDES) {
    const side = s === 'L' ? 'left' : 'right';
    add(`${side}Eye`, 'head', [0.035 * k, 1.6, 0.08]);
    add(`${side}Shoulder`, 'chest', [0.04 * k, 1.38, 0]);
    const sh: Vec3 = [0.16 * k, 1.38, 0];
    const arm = (d: number, z = 0): Vec3 => [sh[0] + Math.cos(a) * d * k, sh[1] - Math.sin(a) * d, z];
    add(`${side}UpperArm`, `${side}Shoulder`, sh);
    add(`${side}LowerArm`, `${side}UpperArm`, arm(0.26));
    add(`${side}Hand`, `${side}LowerArm`, arm(0.5));
    FINGERS.forEach((f, fi) => {
      const z = [0.035, 0.022, 0.006, -0.01, -0.025][fi];
      const start = fi === 0 ? 0.53 : 0.58;
      const names = f === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
      names.forEach((part, pi) => add(`${side}${f}${part}`, pi === 0 ? `${side}Hand` : `${side}${f}${names[pi - 1]}`, arm(start + pi * 0.025, z)));
    });
    add(`${side}UpperLeg`, 'hips', [0.09 * k, 0.9, 0]);
    add(`${side}LowerLeg`, `${side}UpperLeg`, [0.09 * k, 0.5, 0.01]);
    add(`${side}Foot`, `${side}LowerLeg`, [0.09 * k, 0.08, 0]);
    add(`${side}Toes`, `${side}Foot`, [0.09 * k, 0.02, 0.12]);
  }
  if (secondary) {
    add('hair1', 'head', [0, 1.66, -0.09]);
    add('hair2', 'hair1', [0, 1.52, -0.13]);
    add('hair3', 'hair2', [0, 1.38, -0.15]);
    for (const [d, x, z] of [
      ['F', 0, 1],
      ['B', 0, -1],
      ['L', 1, 0],
      ['R', -1, 0],
    ] as const) {
      add(`skirt${d}1`, 'hips', [0.13 * x, 0.88, 0.13 * z]);
      add(`skirt${d}2`, `skirt${d}1`, [0.17 * x, 0.72, 0.17 * z]);
      add(`skirt${d}3`, `skirt${d}2`, [0.2 * x, 0.58, 0.2 * z]);
    }
  }
  return b;
}

const MIXAMO: Record<string, string> = {
  hips: 'Hips', spine: 'Spine', chest: 'Spine1', neck: 'Neck', head: 'Head', headEnd: 'HeadTop_End',
};
const VROID: Record<string, string> = {
  hips: 'J_Bip_C_Hips', spine: 'J_Bip_C_Spine', chest: 'J_Bip_C_Chest', neck: 'J_Bip_C_Neck', head: 'J_Bip_C_Head', headEnd: 'J_Bip_C_HeadTop_End',
};
const BLENDER: Record<string, string> = { hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head', headEnd: 'head_end' };

function boneName(key: string, style: FixtureStyle, i: number): string {
  if (style === 'scrambled') return i === 0 ? 'Root' : `Bone.${String(i).padStart(3, '0')}`;
  const m = /^(left|right)(.*)$/.exec(key);
  const side = m?.[1] === 'left' ? 'L' : 'R';
  const part = m?.[2] ?? key;
  const finger = /^(Thumb|Index|Middle|Ring|Little)(Metacarpal|Proximal|Intermediate|Distal)$/.exec(part);
  const sec = /^(hair|skirt[FBLR])(\d)$/.exec(key);
  if (style === 'mixamo') {
    const S = side === 'L' ? 'Left' : 'Right';
    if (sec) return `mixamorig:${sec[1] === 'hair' ? 'Hair' : `Skirt_${sec[1].slice(5)}`}${sec[2]}`;
    if (finger) {
      const n = { Metacarpal: 1, Proximal: finger[1] === 'Thumb' ? 2 : 1, Intermediate: 2, Distal: 3 }[finger[2]]!;
      return `mixamorig:${S}Hand${finger[1] === 'Little' ? 'Pinky' : finger[1]}${finger[1] === 'Thumb' && finger[2] === 'Distal' ? 3 : n}`;
    }
    const map: Record<string, string> = { Eye: 'Eye', Shoulder: 'Shoulder', UpperArm: 'Arm', LowerArm: 'ForeArm', Hand: 'Hand', UpperLeg: 'UpLeg', LowerLeg: 'Leg', Foot: 'Foot', Toes: 'ToeBase' };
    return `mixamorig:${m ? S + map[part] : MIXAMO[key]}`;
  }
  if (style === 'vrm') {
    if (sec) return sec[1] === 'hair' ? `J_Sec_Hair${sec[2]}_01` : `J_Sec_${sec[1].slice(5)}_Skirt_0${sec[2]}`;
    if (finger) {
      const n = { Metacarpal: 1, Proximal: finger[1] === 'Thumb' ? 2 : 1, Intermediate: 2, Distal: 3 }[finger[2]]!;
      return `J_Bip_${side}_${finger[1]}${n}`;
    }
    const map: Record<string, string> = { Eye: 'FaceEye', Shoulder: 'Shoulder', UpperArm: 'UpperArm', LowerArm: 'LowerArm', Hand: 'Hand', UpperLeg: 'UpperLeg', LowerLeg: 'LowerLeg', Foot: 'Foot', Toes: 'ToeBase' };
    if (part === 'Eye') return `J_Adj_${side}_FaceEye`;
    return m ? `J_Bip_${side}_${map[part]}` : VROID[key];
  }
  // blender / Rigify-like
  if (sec) return sec[1] === 'hair' ? `hair.00${sec[2]}` : `skirt_${sec[1].slice(5).toLowerCase()}.00${sec[2]}`;
  if (finger) {
    const n = { Metacarpal: 1, Proximal: finger[1] === 'Thumb' ? 2 : 1, Intermediate: 2, Distal: 3 }[finger[2]]!;
    const f = { Thumb: 'thumb', Index: 'f_index', Middle: 'f_middle', Ring: 'f_ring', Little: 'f_pinky' }[finger[1]]!;
    return `${f}.0${n}.${side}`;
  }
  const map: Record<string, string> = { Eye: 'eye', Shoulder: 'shoulder', UpperArm: 'upper_arm', LowerArm: 'forearm', Hand: 'hand', UpperLeg: 'thigh', LowerLeg: 'shin', Foot: 'foot', Toes: 'toe' };
  return m ? `${map[part]}.${side}` : BLENDER[key];
}

/** A tiny valid 2×2 PNG (opaque light skin tone). */
const PNG_2x2 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4defErzsnGCAUAEoeCnmPj1ybAAAAAElFTkSuQmCC';

const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface FixtureResult {
  /** GLB (or .vrm) bytes. */
  bytes: Uint8Array;
  /** Canonical key per output bone index (tests). */
  keys: string[];
  names: string[];
}

export interface HumanoidData {
  defs: { key: string; parent: string | null; pos: Vec3 }[];
  idx: Map<string, number>;
  names: string[];
  style: FixtureStyle;
  world: (p: Vec3) => Vec3;
  pos: number[];
  nrm: number[];
  uv: number[];
  joints: number[];
  weights: number[];
  bodyIdx: number[];
  headIdx: number[];
  morphs: { name: string; deltas: Float32Array }[];
  png: Uint8Array;
}

/** Skeleton, skinned geometry and morphs of the test humanoid (world space, scaled). */
export function humanoidData(opts: FixtureOptions = {}): HumanoidData {
  const style = opts.style ?? 'mixamo';
  const scale = opts.scale ?? 1;
  const defs = skeleton(opts.armDown ?? 0, opts.secondary ?? true);
  const idx = new Map(defs.map((d, i) => [d.key, i]));
  const names = defs.map((d, i) => boneName(d.key, style, i));
  const flip = opts.facingBack ? -1 : 1;
  const world = (p: Vec3): Vec3 => [p[0] * scale * flip, p[1] * scale, p[2] * scale * flip];

  // Geometry: a box per bone segment (bone → first child), skinned to that bone.
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  const bodyIdx: number[] = [];
  const headIdx: number[] = [];
  const children = new Map<string, string[]>();
  for (const d of defs) if (d.parent) children.set(d.parent, [...(children.get(d.parent) ?? []), d.key]);
  const box = (a: Vec3, bb: Vec3, r: number, bone: number, out: number[], parentBone = -1): number => {
    const start = pos.length / 3;
    const dir = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d = dir.map((v) => v / len);
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(d, up));
    const v = cross(u, d);
    const corners: Vec3[] = [];
    for (const t of [0, 1])
      for (const [su, sv] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const c = t ? bb : a;
        corners.push([c[0] + (u[0] * su + v[0] * sv) * r, c[1] + (u[1] * su + v[1] * sv) * r, c[2] + (u[2] * su + v[2] * sv) * r]);
      }
    // 6 faces, 4 verts each (flat normals), CCW seen from outside.
    const faces = [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    for (const f of faces) {
      const base = pos.length / 3;
      const p0 = corners[f[0]];
      const n = norm(cross(sub(corners[f[1]], p0), sub(corners[f[2]], p0)));
      f.forEach((ci, k) => {
        pos.push(...corners[ci]);
        nrm.push(...n);
        uv.push(k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0);
        // The start cap blends with the parent bone, so joints bend smoothly.
        if (ci < 4 && parentBone >= 0) {
          joints.push(bone, parentBone, 0, 0);
          weights.push(0.5, 0.5, 0, 0);
        } else {
          joints.push(bone, 0, 0, 0);
          weights.push(1, 0, 0, 0);
        }
      });
      out.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return start;
  };
  let faceStart = 0;
  for (const d of defs) {
    const kids = children.get(d.key) ?? [];
    const child = kids.find((k) => !/Eye$/.test(k) && !/^hair|^skirt/.test(k) && !/Shoulder$/.test(k) && !/UpperLeg$/.test(k)) ?? kids[0];
    if (!child || /Eye$/.test(d.key)) continue;
    const r = /hips|spine|chest/.test(d.key) ? 0.11 : /Upper(Leg|Arm)|LowerLeg/.test(d.key) ? 0.045 : /head/.test(d.key) ? 0.1 : 0.02;
    const parent = d.parent ? idx.get(d.parent)! : -1;
    if (d.key === 'head') faceStart = box(d.pos, defs[idx.get(child)!].pos, r, idx.get(d.key)!, headIdx, parent);
    else box(d.pos, defs[idx.get(child)!].pos, r, idx.get(d.key)!, bodyIdx, parent);
  }
  const vertCount = pos.length / 3;
  // Morphs on the head box: blink lowers the top, "aa" drops the bottom (face front verts only).
  const blink = new Float32Array(vertCount * 3);
  const aa = new Float32Array(vertCount * 3);
  const blinkR = new Float32Array(vertCount * 3);
  for (let v = faceStart; v < faceStart + 24; v++) {
    const y = pos[v * 3 + 1];
    if (y > 1.64) blink[v * 3 + 1] = -0.02;
    if (y > 1.64 && pos[v * 3] < 0) blinkR[v * 3 + 1] = -0.02;
    if (y < 1.56) aa[v * 3 + 1] = -0.015;
  }

  // Apply world scale / facing to the vertex data.
  for (let v = 0; v < vertCount; v++) {
    const p = world([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
    pos.splice(v * 3, 3, ...p);
    nrm[v * 3] *= flip;
    nrm[v * 3 + 2] *= flip;
    for (const m of [blink, aa, blinkR]) {
      m[v * 3] *= scale * flip;
      m[v * 3 + 1] *= scale;
      m[v * 3 + 2] *= scale * flip;
    }
  }

  const morphNames =
    style === 'mixamo'
      ? ['eyesClosed', 'jawOpen', 'eyeBlinkRight']
      : style === 'vrm'
        ? ['Fcl_EYE_Close', 'Fcl_MTH_A', 'Fcl_EYE_Close_R']
        : ['blink', 'mouth_a', 'blink_R'];
  return {
    defs,
    idx,
    names,
    style,
    world,
    pos,
    nrm,
    uv,
    joints,
    weights,
    bodyIdx,
    headIdx,
    morphs: [blink, aa, blinkR].map((deltas, k) => ({ name: morphNames[k], deltas })),
    png: b64(PNG_2x2),
  };
}

export function makeHumanoid(opts: FixtureOptions = {}): FixtureResult {
  const { defs, idx, names, style, world, pos, nrm, uv, joints, weights, bodyIdx, headIdx, morphs, png } = humanoidData(opts);
  const [blink, aa, blinkR] = morphs.map((m) => m.deltas);
  const morphNames = morphs.map((m) => m.name);
  // ---------------------------------------------------------------- glTF assembly
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const views: object[] = [];
  const accessors: object[] = [];
  const pushView = (data: ArrayBufferView, target?: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    chunks.push(bytes, new Uint8Array(pad));
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    offset += bytes.length + pad;
    return views.length - 1;
  };
  const acc = (data: Float32Array | Uint16Array | Uint32Array, type: string, ct: number, minmax = false): number => {
    const view = pushView(data);
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type]!;
    const a: Record<string, unknown> = { bufferView: view, componentType: ct, count: data.length / n, type };
    if (minmax) {
      const min = Array(n).fill(Infinity);
      const max = Array(n).fill(-Infinity);
      for (let i = 0; i < data.length; i++) {
        min[i % n] = Math.min(min[i % n], data[i]);
        max[i % n] = Math.max(max[i % n], data[i]);
      }
      Object.assign(a, { min, max });
    }
    accessors.push(a);
    return accessors.length - 1;
  };
  const aPos = acc(new Float32Array(pos), 'VEC3', 5126, true);
  const aNrm = acc(new Float32Array(nrm), 'VEC3', 5126);
  const aUv = acc(new Float32Array(uv), 'VEC2', 5126);
  const aJ = acc(new Uint16Array(joints), 'VEC4', 5123);
  const aW = acc(new Float32Array(weights), 'VEC4', 5126);
  const aBody = acc(new Uint32Array(bodyIdx), 'SCALAR', 5125);
  const aHead = acc(new Uint32Array(headIdx), 'SCALAR', 5125);
  const aBlink = acc(blink, 'VEC3', 5126, true);
  const aAa = acc(aa, 'VEC3', 5126, true);
  const aBlinkR = acc(blinkR, 'VEC3', 5126, true);
  const ibm = new Float32Array(defs.length * 16);
  defs.forEach((d, i) => {
    const p = world(d.pos);
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16);
  });
  const aIbm = acc(ibm, 'MAT4', 5126);
  const imgView = pushView(png);

  const nodes: Record<string, unknown>[] = defs.map((d, i) => {
    const p = world(d.pos);
    const pp = d.parent ? world(defs[idx.get(d.parent)!].pos) : [0, 0, 0];
    const kids = defs.map((c, ci) => (c.parent === d.key ? ci : -1)).filter((x) => x >= 0);
    return { name: names[i], translation: [p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]], ...(kids.length ? { children: kids } : {}) };
  });
  const meshNode = nodes.length;
  nodes.push({ name: 'Body', mesh: 0, skin: 0 });
  const armature = nodes.length;
  nodes.push({ name: style === 'mixamo' ? 'Armature' : 'Root_Armature', children: [0] });
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'MMD Studio test humanoid', copyright: 'Public domain test model' },
    scene: 0,
    scenes: [{ name: opts.name ?? `Test ${style}`, nodes: [armature, meshNode] }],
    nodes,
    meshes: [
      {
        name: 'Body',
        primitives: [
          { attributes: { POSITION: aPos, NORMAL: aNrm, TEXCOORD_0: aUv, JOINTS_0: aJ, WEIGHTS_0: aW }, indices: aBody, material: 0, targets: [{ POSITION: aBlink }, { POSITION: aAa }, { POSITION: aBlinkR }] },
          { attributes: { POSITION: aPos, NORMAL: aNrm, TEXCOORD_0: aUv, JOINTS_0: aJ, WEIGHTS_0: aW }, indices: aHead, material: 1, targets: [{ POSITION: aBlink }, { POSITION: aAa }, { POSITION: aBlinkR }] },
        ],
        extras: { targetNames: morphNames },
      },
    ],
    skins: [{ joints: defs.map((_, i) => i), inverseBindMatrices: aIbm, skeleton: 0 }],
    materials: [
      { name: 'Body', pbrMetallicRoughness: { baseColorFactor: [0.55, 0.7, 1, 1] } },
      { name: 'Face', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } }, doubleSided: true },
    ],
    textures: [{ source: 0 }],
    images: [{ name: 'face_skin', bufferView: imgView, mimeType: 'image/png' }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };

  if (opts.vrm !== undefined) {
    const humanKeys = defs.map((d) => d.key).filter((k) => !/^hair|^skirt|headEnd/.test(k));
    const sec = defs.map((d, i) => [d.key, i] as const).filter(([k]) => /^(hair|skirt.)1$/.test(k));
    const extensionsUsed: string[] = [];
    if (opts.vrm === 1) {
      extensionsUsed.push('VRMC_vrm', 'VRMC_springBone');
      json.extensions = {
        VRMC_vrm: {
          specVersion: '1.0',
          meta: { name: opts.name ?? 'Test VRM', version: '1', authors: ['MMD Studio'], licenseUrl: 'https://vrm.dev/licenses/1.0/', avatarPermission: 'everyone', commercialUsage: 'personalNonProfit', allowRedistribution: false, modification: 'allowModification' },
          humanoid: { humanBones: Object.fromEntries(humanKeys.map((k) => [k, { node: idx.get(k)! }])) },
          expressions: {
            preset: {
              blink: { morphTargetBinds: [{ node: meshNode, index: 0, weight: 1 }] },
              aa: { morphTargetBinds: [{ node: meshNode, index: 1, weight: 1 }] },
            },
          },
        },
        VRMC_springBone: {
          specVersion: '1.0',
          colliders: [{ node: idx.get('head')!, shape: { sphere: { offset: [0, 0.1, 0], radius: 0.1 } } }],
          colliderGroups: [{ colliders: [0] }],
          springs: sec.map(([k]) => {
            const chain = defs.map((d, i) => [d.key, i] as const).filter(([kk]) => kk.startsWith(k.slice(0, -1)));
            return { name: k.slice(0, -1), joints: chain.map(([, i]) => ({ node: i, hitRadius: 0.02, stiffness: 1, dragForce: 0.4, gravityPower: 0 })), colliderGroups: [0] };
          }),
        },
      };
    } else {
      extensionsUsed.push('VRM');
      const vrm0Name: Record<string, string> = { leftThumbMetacarpal: 'leftThumbProximal', leftThumbProximal: 'leftThumbIntermediate', rightThumbMetacarpal: 'rightThumbProximal', rightThumbProximal: 'rightThumbIntermediate' };
      json.extensions = {
        VRM: {
          exporterVersion: 'MMD Studio test',
          meta: { title: opts.name ?? 'Test VRM 0', version: '1', author: 'MMD Studio', allowedUserName: 'Everyone', violentUssageName: 'Disallow', sexualUssageName: 'Disallow', commercialUssageName: 'Disallow', licenseName: 'CC_BY' },
          humanoid: { humanBones: humanKeys.map((k) => ({ bone: vrm0Name[k] ?? k, node: idx.get(k)! })) },
          blendShapeMaster: {
            blendShapeGroups: [
              { name: 'Blink', presetName: 'blink', binds: [{ mesh: 0, index: 0, weight: 100 }] },
              { name: 'A', presetName: 'a', binds: [{ mesh: 0, index: 1, weight: 100 }] },
            ],
          },
          secondaryAnimation: {
            boneGroups: [{ comment: 'hair', stiffiness: 1, gravityPower: 0, dragForce: 0.4, hitRadius: 0.02, bones: sec.map(([, i]) => i), colliderGroups: [0] }],
            colliderGroups: [{ node: idx.get('head')!, colliders: [{ offset: { x: 0, y: 0.1, z: 0 }, radius: 0.1 }] }],
          },
          materialProperties: [],
        },
      };
    }
    json.extensionsUsed = extensionsUsed;
  }

  const bin = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.length;
  }
  return { bytes: glb(json, bin), keys: defs.map((d) => d.key), names };
}

export function glb(json: object, bin: Uint8Array): Uint8Array {
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) {
    const padded = new Uint8Array(jsonBytes.length + jpad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const bo = 20 + jsonBytes.length;
  dv.setUint32(bo, bin.length, true);
  dv.setUint32(bo + 4, 0x004e4942, true);
  out.set(bin, bo + 8);
  return out;
}

function sub(a: readonly number[], b: readonly number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: readonly number[], b: readonly number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: number[]): number[] {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
