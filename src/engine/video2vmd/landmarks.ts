/** MediaPipe Pose landmark indices (33-point BlazePose topology). L/R are the person's own sides. */
export const LM = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const LANDMARK_COUNT = 33;

/** Left/right landmark pairs (swapped for mirrored videos). */
export const MIRROR_PAIRS: [number, number][] = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];

/** Index permutation that swaps every left/right pair. */
export const MIRROR_INDEX: number[] = (() => {
  const out = Array.from({ length: LANDMARK_COUNT }, (_, i) => i);
  for (const [a, b] of MIRROR_PAIRS) {
    out[a] = b;
    out[b] = a;
  }
  return out;
})();

/** Edges drawn in the skeleton overlay. */
export const SKELETON_EDGES: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [15, 19],
  [16, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [27, 31],
  [28, 30],
  [30, 32],
  [28, 32],
  [0, 7],
  [0, 8],
];

/** Kinematic tree used for bone-length normalisation: [parent, child]. Root = hip centre (virtual). */
export const LIMBS: [number, number][] = [
  [23, 25],
  [25, 27],
  [27, 29],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [28, 32],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
];

/** Limbs checked for outliers (long, reliable segments). */
export const OUTLIER_LIMBS: [number, number][] = [
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [11, 12],
  [23, 24],
];

/** Body-part names for warnings. */
export const PART_NAME: Record<number, string> = {
  0: 'head',
  11: 'left shoulder',
  12: 'right shoulder',
  13: 'left elbow',
  14: 'right elbow',
  15: 'left hand',
  16: 'right hand',
  23: 'left hip',
  24: 'right hip',
  25: 'left knee',
  26: 'right knee',
  27: 'left foot',
  28: 'right foot',
};
