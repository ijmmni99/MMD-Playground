// Shared types for the v2 Video → VMD features: face, hands, two-view sync / calibration.
// Image coordinates are normalised to the analysed area (the user's crop of the video), like the body
// pose landmarks: x → right, y → down, 0..1.

/** Square-ish window in normalised analysed-area coordinates. */
export interface CropWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ARKit / MediaPipe Face Landmarker blendshape names, in MediaPipe's output order. */
export const BLENDSHAPES = [
  '_neutral',
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawOpen',
  'jawRight',
  'mouthClose',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthFunnel',
  'mouthLeft',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthPucker',
  'mouthRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'noseSneerLeft',
  'noseSneerRight',
] as const;
export type Blendshape = (typeof BLENDSHAPES)[number];
export const BLEND_INDEX: Record<Blendshape, number> = Object.fromEntries(
  BLENDSHAPES.map((n, i) => [n, i]),
) as Record<Blendshape, number>;

/**
 * Face-mesh points kept per frame (indices into MediaPipe's 478-point mesh). Eye "A" is the eye whose
 * corners are 33 / 133 — the person's right eye (image left in an unmirrored video); eye "B" is 263 / 362.
 */
export const FACE_POINTS = {
  aOuter: 33,
  aInner: 133,
  aTop: 159,
  aBottom: 145,
  aIris: 468,
  bOuter: 263,
  bInner: 362,
  bTop: 386,
  bBottom: 374,
  bIris: 473,
  mouthA: 61,
  mouthB: 291,
  lipTop: 13,
  lipBottom: 14,
  noseTip: 1,
  chin: 152,
  forehead: 10,
  browA: 105,
  browB: 334,
} as const;
export type FacePoint = keyof typeof FACE_POINTS;
export const FACE_POINT_KEYS = Object.keys(FACE_POINTS) as FacePoint[];
export const FACE_MESH_INDICES: number[] = FACE_POINT_KEYS.map((k) => FACE_POINTS[k]);

/** One frame of face tracking. */
export interface FaceObs {
  /** Detection / presence confidence 0..1. */
  score: number;
  /** BLENDSHAPES.length values, 0..1. */
  blend: number[];
  /**
   * Facial transformation matrix (column-major 4×4) from MediaPipe: canonical face → camera space
   * (right-handed, y up, z toward the viewer). Identity rotation = face looking straight at the camera.
   */
  matrix: number[];
  /** FACE_POINT_KEYS.length × [x, y] in normalised analysed-area coordinates. */
  points: number[];
  /** Where the face crop was taken (normalised analysed area). */
  crop: CropWindow;
}

/** MediaPipe Hand Landmarker topology (21 points). */
export const HAND = {
  wrist: 0,
  thumbCmc: 1,
  thumbMcp: 2,
  thumbIp: 3,
  thumbTip: 4,
  indexMcp: 5,
  indexPip: 6,
  indexDip: 7,
  indexTip: 8,
  middleMcp: 9,
  middlePip: 10,
  middleDip: 11,
  middleTip: 12,
  ringMcp: 13,
  ringPip: 14,
  ringDip: 15,
  ringTip: 16,
  pinkyMcp: 17,
  pinkyPip: 18,
  pinkyDip: 19,
  pinkyTip: 20,
} as const;
export const HAND_POINTS = 21;
/** Point chains per finger, wrist first. */
export const FINGER_CHAINS: Record<Finger, number[]> = {
  thumb: [0, 1, 2, 3, 4],
  index: [0, 5, 6, 7, 8],
  middle: [0, 9, 10, 11, 12],
  ring: [0, 13, 14, 15, 16],
  little: [0, 17, 18, 19, 20],
};
export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
export const FINGERS: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];
export const HAND_EDGES: [number, number][] = Object.values(FINGER_CHAINS).flatMap((c) =>
  c.slice(1).map((p, i): [number, number] => [c[i], p]),
);

/** One hand from one wrist crop. */
export interface HandObs {
  score: number;
  /** Label from the model ("Left" / "Right" as MediaPipe reports it) and its score. */
  handedness: string;
  handednessScore: number;
  /** 21 × [x, y, z] normalised analysed-area coordinates (z relative depth). */
  image: number[];
  /** 21 × [x, y, z] metric hand-world coordinates (metres, MediaPipe camera axes: y down, z away). */
  world: number[];
  crop: CropWindow;
}

/**
 * Hands per frame, indexed by the **body pose wrist** whose crop they came from: 0 = MediaPipe pose
 * landmark 15 ("left wrist"), 1 = landmark 16. The side is resolved from the body, not the handedness label.
 */
export type HandPair = [HandObs | null, HandObs | null];

/** Time alignment of the side view against the front view. */
export interface ViewSync {
  /** side time = front time + offset (seconds). */
  offset: number;
  /** 0..1. */
  confidence: number;
  method: 'audio' | 'motion' | 'manual';
}

/** Relationship of the side camera to the front camera (world = front camera MMD-axis frame). */
export interface Calibration {
  /** Side camera yaw around +Y, degrees, positive toward the dancer's left (+X). */
  yawDeg: number;
  /** Mean residual translation side → front after rotation (metres, ≈ 0 for hip-centred data). */
  translation: [number, number, number];
  /** Side world scale relative to the front (multiply side points by this). */
  scale: number;
  /** Floor height (metres, hip-centred frame). */
  floorY: number;
  /** Estimated horizontal FOV used for triangulation (degrees). */
  fovDeg: number;
  /** Camera distances (metres) estimated by weak perspective. */
  distance: [number, number];
  /** 0..1 overall confidence. */
  confidence: number;
  /** Inlier fraction of the robust fit. */
  inliers: number;
  warnings: string[];
}

export type FeatureFlags = { twoView: boolean; face: boolean; fingers: boolean };

export interface MorphMapEntry {
  /** MMD morph name written to the VMD. */
  morph: string;
  /** Source expression id (see face.ts SOURCES). */
  source: string;
  gain: number;
  offset: number;
  enabled: boolean;
  group: 'eye' | 'mouth' | 'brow' | 'other';
}

export interface FaceSettings {
  map: MorphMapEntry[];
  /** One Euro filter for morph weights. */
  minCutoff: number;
  beta: number;
  /** Values below this are zeroed (then rescaled). */
  deadzone: number;
  /** Mouth attack / release times (seconds). */
  attack: number;
  release: number;
  /** Minimum blink duration in frames at 30 fps. */
  minBlinkFrames: number;
  /** Morph keyframe reduction tolerance (weight units). */
  reduceTolerance: number;
  /** Write eye bones (両目 or 左目/右目). */
  eyes: boolean;
  /** Blend the face's head rotation into 首/頭 (0..1). */
  headBlend: number;
  /** Mouth vowels from the audio instead of the video. */
  lipSync: boolean;
}

export interface HandSettings {
  minCutoff: number;
  beta: number;
  /** Snap low-confidence frames to the nearest preset pose. */
  presetSnap: boolean;
  /** Refine 手首 / 手捩 from the hand landmarks. */
  wristRefine: boolean;
  /** Degrees. */
  reduceTolerance: number;
  /** Hold the last pose this long on dropout before easing to relaxed (seconds). */
  holdSeconds: number;
}

export interface TwoViewSettings {
  /** Manual relative angle (prior), degrees 30..150. */
  angleDeg: number;
  /** Manual offset override (seconds) or null for auto. */
  manualOffset: number | null;
  /** Horizontal field of view guess for triangulation (degrees). */
  fovDeg: number;
  /** Use DLT triangulation where it reprojects better. */
  triangulate: boolean;
}
