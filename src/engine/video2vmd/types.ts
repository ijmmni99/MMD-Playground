import type { FaceObs, HandPair } from '@/lib/video2vmd/types';

/** Landmark values per frame: 33 × [x, y, z, visibility]. */
export type LandmarkArray = Float32Array | number[];

export interface PoseFrame {
  /** Source time in seconds (relative to the start of the video). */
  time: number;
  detected: boolean;
  /** Normalised image coordinates (x, y in 0..1 of the analysed area, z relative depth, visibility). */
  image: LandmarkArray;
  /** Metric world coordinates (metres, hip-centred, MediaPipe axes) + visibility. */
  world: LandmarkArray;
  /** Number of people detected in the frame (when the estimator can tell). */
  people?: number;
  /** Face tracking (crop pass), when enabled. */
  face?: FaceObs | null;
  /** Hands per body wrist (crop pass), when enabled. */
  hands?: HandPair | null;
}

export interface CropBox {
  /** Normalised 0..1 of the source frame. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VideoInfo {
  name: string;
  width: number;
  height: number;
  /** Frames per second of the source (estimated when the container does not say). */
  fps: number;
  duration: number;
  hasAudio: boolean;
  codec?: string;
}

/** Everything pose estimation produced; stored as JSON so retargeting can be re-run without ML. */
export interface PoseSequence {
  version: 1;
  estimator: string;
  video: VideoInfo;
  /** Trim range in seconds. */
  trim: [number, number];
  crop: CropBox | null;
  /** Pixel size of the analysed (cropped, possibly downscaled) frames. */
  analysedSize: [number, number];
  /** Rate frames were sampled at. */
  sampleFps: number;
  frames: PoseFrame[];
}

export type PresetId = 'default' | 'slow' | 'fast' | 'upper';

export interface ConversionSettings {
  preset: PresetId;
  /** Mirror (selfie / flipped) video: swap left and right. */
  mirror: boolean;
  /** One Euro filter. */
  minCutoff: number;
  beta: number;
  /** Landmarks below this visibility are treated as missing and interpolated. */
  visibilityThreshold: number;
  /** Limb-length deviation (fraction of the median) that marks a frame as an outlier. */
  outlierThreshold: number;
  /** Foot IK targets pinned during contacts (else FK only, IK disabled in the VMD). */
  footIk: boolean;
  /** Foot contact thresholds, as fractions of leg length (height) and leg lengths per second (speed). */
  contactHeight: number;
  contactSpeed: number;
  /** Root motion multipliers. */
  rootStrength: number;
  rootDepthStrength: number;
  /** Extra scale on top of the automatic model-size match. */
  scale: number;
  /** Drive legs and センター (off for seated / cropped videos). */
  lowerBody: boolean;
  /** Keyframe reduction tolerance (degrees for rotations; MMD units ×10 for positions). 0 = keep all. */
  reduceTolerance: number;
}

export const DEFAULT_SETTINGS: ConversionSettings = {
  preset: 'default',
  mirror: false,
  minCutoff: 1.2,
  beta: 0.3,
  visibilityThreshold: 0.35,
  outlierThreshold: 0.35,
  footIk: true,
  contactHeight: 0.08,
  contactSpeed: 0.9,
  rootStrength: 1,
  rootDepthStrength: 0.5,
  scale: 1,
  lowerBody: true,
  reduceTolerance: 0.4,
};

export const PRESETS: Record<
  PresetId,
  { label: string; description: string; settings: Partial<ConversionSettings> }
> = {
  default: { label: 'Balanced', description: 'Good starting point for most dance videos.', settings: {} },
  slow: {
    label: 'Slow / clean',
    description: 'Heavier smoothing for slow, flowing moves; removes more jitter.',
    settings: { minCutoff: 0.6, beta: 0.12, reduceTolerance: 0.6 },
  },
  fast: {
    label: 'Fast dance',
    description: 'Lighter smoothing so quick hits and kicks are not softened.',
    settings: { minCutoff: 2.2, beta: 0.8, contactSpeed: 1.2, reduceTolerance: 0.25 },
  },
  upper: {
    label: 'Upper body only',
    description: 'Seated or waist-up videos: locks legs and センター.',
    settings: { lowerBody: false, footIk: false, rootStrength: 0, rootDepthStrength: 0 },
  },
};

export function presetSettings(
  id: PresetId,
  base: ConversionSettings = DEFAULT_SETTINGS,
): ConversionSettings {
  return { ...DEFAULT_SETTINGS, ...PRESETS[id].settings, mirror: base.mirror, scale: base.scale, preset: id };
}

export interface QualityWarning {
  time: number;
  message: string;
}

export interface QualityReport {
  frames: number;
  detectedPct: number;
  avgConfidence: number;
  /** Mean horizontal foot speed during contacts before / after pinning (MMD units per second). */
  footSkateBefore: number;
  footSkateAfter: number;
  /** Mean frame-to-frame acceleration of key joints (lower is smoother). */
  jitterRaw: number;
  jitterClean: number;
  outlierFrames: number;
  multiPersonFrames: number;
  keysOriginal: number;
  keysReduced: number;
  warnings: QualityWarning[];
}
