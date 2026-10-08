// The converter's intermediate model: one shape for FBX, glTF/GLB and VRM input.
// Space: glTF convention — right-handed, +Y up, metres; the model ideally faces +Z (normalization
// detects and fixes other facings). Everything is in the bind (rest) pose, already in world space.

export type Vec3 = [number, number, number];

export interface SourceBone {
  name: string;
  /** Index into `bones`, -1 for a root. */
  parent: number;
  /** Rest-pose world position. */
  position: Vec3;
}

export interface SourceMorph {
  name: string;
  /** Position deltas (3 per vertex). */
  deltas: Float32Array;
}

export interface SourceMesh {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Triangle list. */
  indices: Uint32Array;
  /** 4 influences per vertex: bone indices into `SourceModel.bones` and weights. */
  joints: Uint16Array;
  weights: Float32Array;
  material: number;
  morphs: SourceMorph[];
  /** glTF mesh index this primitive came from (VRM expression binds). */
  meshIndex?: number;
  /** glTF node index that instanced it (VRM 1.0 binds by node). */
  nodeIndex?: number;
}

export interface SourceMaterial {
  name: string;
  color: [number, number, number, number];
  texture: number;
  alphaMode: 'opaque' | 'mask' | 'blend';
  alphaCutoff: number;
  doubleSided: boolean;
  emissive: Vec3;
  unlit: boolean;
  mtoon?: { shade: Vec3; outlineWidth: number; outlineColor: Vec3 };
}

export interface SourceTexture {
  name: string;
  mime: string;
  data: Uint8Array;
}

/** VRM humanoid bone names (VRM 1.0 naming; 0.x is mapped onto the same keys). */
export type HumanSlot =
  | 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head' | 'leftEye' | 'rightEye' | 'jaw'
  | 'leftShoulder' | 'leftUpperArm' | 'leftLowerArm' | 'leftHand'
  | 'rightShoulder' | 'rightUpperArm' | 'rightLowerArm' | 'rightHand'
  | 'leftUpperLeg' | 'leftLowerLeg' | 'leftFoot' | 'leftToes'
  | 'rightUpperLeg' | 'rightLowerLeg' | 'rightFoot' | 'rightToes'
  | `${'left' | 'right'}${'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Little'}${'Metacarpal' | 'Proximal' | 'Intermediate' | 'Distal'}`;

export interface SourceExpression {
  /** Original name. */
  name: string;
  /** VRM preset (blink, aa, happy…), lower-case VRM 1.0 naming. */
  preset?: string;
  binds: { mesh: number; morph: number; weight: number }[];
}

export interface SpringJoint {
  bone: number;
  radius: number;
  stiffness: number;
  drag: number;
  gravity: number;
}

export interface SpringChain {
  name: string;
  joints: SpringJoint[];
  colliders: number[];
}

export interface SpringCollider {
  bone: number;
  offset: Vec3;
  radius: number;
  tail?: Vec3;
}

export interface SourceLicense {
  title?: string;
  author?: string;
  version?: string;
  allowedUsers?: string;
  commercial?: string;
  redistribution?: string;
  modification?: string;
  violence?: string;
  sexual?: string;
  licenseName?: string;
  url?: string;
  otherUrl?: string;
  text?: string;
}

export interface SourceModel {
  name: string;
  format: 'gltf' | 'glb' | 'vrm0' | 'vrm1' | 'fbx';
  bones: SourceBone[];
  meshes: SourceMesh[];
  materials: SourceMaterial[];
  textures: SourceTexture[];
  humanoid?: Partial<Record<HumanSlot, number>>;
  expressions?: SourceExpression[];
  springs?: { chains: SpringChain[]; colliders: SpringCollider[] };
  license?: SourceLicense;
  warnings: string[];
}
