// PMX 2.0 model records, 1:1 with the file format (what the writer and validator take).

export type V2 = [number, number];
export type V3 = [number, number, number];
export type V4 = [number, number, number, number];

export interface PmxVertex {
  position: V3;
  normal: V3;
  uv: V2;
  /** Up to 4 influences (bone index, weight); weights sum to 1. One influence = BDEF1, two = BDEF2. */
  bones: number[];
  weights: number[];
  edgeScale: number;
  /** SDEF parameters (two bones). */
  sdef?: { c: V3; r0: V3; r1: V3 };
  /** QDEF (dual quaternion, four bones). */
  qdef?: boolean;
  /** Additional UVs (PMX "additional vec4"), `PmxModel.additionalUvCount` of them. */
  addUv?: V4[];
}

export const MaterialFlag = {
  DoubleSided: 0x01,
  GroundShadow: 0x02,
  DrawShadow: 0x04,
  ReceiveShadow: 0x08,
  Edge: 0x10,
} as const;

export interface PmxMaterial {
  name: string;
  nameEn: string;
  diffuse: V4;
  specular: V3;
  shininess: number;
  ambient: V3;
  flags: number;
  edgeColor: V4;
  edgeSize: number;
  /** Index into `textures`, -1 = none. */
  texture: number;
  sphere: number;
  sphereMode: 0 | 1 | 2 | 3;
  /** Shared toon 0–9 (toon01–10.bmp), or -1 for none / custom. */
  sharedToon: number;
  /** Custom toon texture index (when `sharedToon` is -1); -1 or absent = none. */
  toon?: number;
  memo: string;
  /** Triangle index count (3 × faces) for this material, in order. */
  indexCount: number;
}

export const BoneFlag = {
  TailIsBone: 0x0001,
  Rotatable: 0x0002,
  Movable: 0x0004,
  Visible: 0x0008,
  Enabled: 0x0010,
  IK: 0x0020,
  AppendRotate: 0x0100,
  AppendMove: 0x0200,
  FixedAxis: 0x0400,
  LocalAxis: 0x0800,
  AfterPhysics: 0x1000,
} as const;

export interface PmxIkLink {
  bone: number;
  limit?: { min: V3; max: V3 };
}

export interface PmxBone {
  name: string;
  nameEn: string;
  position: V3;
  parent: number;
  layer: number;
  /** BoneFlag bits; TailIsBone / IK / Append* / FixedAxis / LocalAxis are derived from the fields below. */
  flags: number;
  /** Tail: a bone index, or an offset. */
  tail: number | V3;
  append?: { parent: number; ratio: number; rotate: boolean; move: boolean };
  fixedAxis?: V3;
  localAxis?: { x: V3; z: V3 };
  ik?: { target: number; loop: number; limit: number; links: PmxIkLink[] };
  /** External parent key (flag 0x2000). */
  externalParent?: number;
}

export type MorphPanel = 0 | 1 | 2 | 3 | 4; // system, eyebrow, eye, mouth, other

export interface PmxMaterialMorphOffset {
  /** Material index, -1 = all materials. */
  material: number;
  /** 0 = multiply, 1 = add. */
  op: 0 | 1;
  diffuse: V4;
  specular: V3;
  shininess: number;
  ambient: V3;
  edgeColor: V4;
  edgeSize: number;
  texture: V4;
  sphere: V4;
  toon: V4;
}

type MorphBase = { name: string; nameEn: string; panel: MorphPanel };

export type PmxMorph =
  | (MorphBase & { kind: 'vertex'; offsets: { vertex: number; offset: V3 }[] })
  | (MorphBase & { kind: 'group'; offsets: { morph: number; weight: number }[] })
  | (MorphBase & { kind: 'bone'; offsets: { bone: number; position: V3; rotation: V4 }[] })
  /** `uvIndex` 0 = base UV, 1–4 = additional UVs. */
  | (MorphBase & { kind: 'uv'; uvIndex: number; offsets: { vertex: number; offset: V4 }[] })
  | (MorphBase & { kind: 'material'; offsets: PmxMaterialMorphOffset[] })
  | (MorphBase & { kind: 'flip'; offsets: { morph: number; weight: number }[] })
  | (MorphBase & {
      kind: 'impulse';
      offsets: { body: number; local: boolean; velocity: V3; torque: V3 }[];
    });

export interface PmxDisplayFrame {
  name: string;
  nameEn: string;
  special: boolean;
  items: { kind: 'bone' | 'morph'; index: number }[];
}

export interface PmxRigidBody {
  name: string;
  nameEn: string;
  bone: number;
  group: number;
  /** Bit i set = collides with group i (stored as is; editors show the inverse as "no collision" groups). */
  collidesWith: number;
  shape: 0 | 1 | 2; // sphere, box, capsule
  size: V3;
  position: V3;
  rotation: V3;
  mass: number;
  linearDamping: number;
  angularDamping: number;
  restitution: number;
  friction: number;
  mode: 0 | 1 | 2; // bone-follow, physics, physics + bone position
}

export interface PmxJoint {
  name: string;
  nameEn: string;
  a: number;
  b: number;
  position: V3;
  rotation: V3;
  moveMin: V3;
  moveMax: V3;
  rotateMin: V3;
  rotateMax: V3;
  springMove: V3;
  springRotate: V3;
}

export interface PmxModel {
  /** Number of additional vec4 UVs per vertex (0–4). */
  additionalUvCount?: number;
  name: string;
  nameEn: string;
  comment: string;
  commentEn: string;
  vertices: PmxVertex[];
  /** Triangles (3 indices each), grouped per material in material order. */
  indices: Uint32Array | number[];
  /** Relative texture paths (e.g. `tex/body.png`). */
  textures: string[];
  materials: PmxMaterial[];
  bones: PmxBone[];
  morphs: PmxMorph[];
  frames: PmxDisplayFrame[];
  rigidBodies: PmxRigidBody[];
  joints: PmxJoint[];
}
