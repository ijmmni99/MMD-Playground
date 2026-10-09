// Test backends for v2 (two-view, face, hands): they ignore the pixels and return what a camera at a known
// position would see of the synthetic dancer (src/lib/video2vmd/synthetic.ts). Pair them with videos
// rendered from the same cameras (scripts/make-twoview-fixture.ts) so overlays line up.
import { areaToCrop } from '@/lib/video2vmd/crop';
import { fixtureCameras, syntheticScene, viewFrame, type ViewFrame } from '@/lib/video2vmd/synthetic';
import type { EstimatorStatus, PoseEstimate, PoseEstimator } from './estimator';
import type { FaceContext, FaceEstimate, FaceEstimator } from './faceEstimator';
import type { HandContext, HandEstimate, HandEstimator } from './handEstimator';

export interface SyntheticViewConfig {
  role: 'front' | 'side';
  /** Side camera yaw (degrees). */
  sideYawDeg: number;
  /** side time = front time + offset (seconds). */
  offset: number;
  depthHeavy: boolean;
  size: [number, number];
}

export const DEFAULT_SYNTHETIC_VIEW: SyntheticViewConfig = {
  role: 'front',
  sideYawDeg: 90,
  offset: 0,
  depthHeavy: true,
  size: [640, 360],
};

const cache = new Map<string, ViewFrame>();

/** Observation of the synthetic dancer by a view at that view's local time. */
export function syntheticView(cfg: SyntheticViewConfig, timeSec: number): ViewFrame {
  const t = cfg.role === 'side' ? timeSec - cfg.offset : timeSec;
  const key = `${cfg.role}|${cfg.sideYawDeg}|${cfg.depthHeavy}|${cfg.size.join('x')}|${t.toFixed(4)}`;
  let v = cache.get(key);
  if (!v) {
    const [front, side] = fixtureCameras(cfg.sideYawDeg, cfg.size);
    v = viewFrame(syntheticScene(t, { depthHeavy: cfg.depthHeavy }), {
      camera: cfg.role === 'side' ? side : front,
    });
    if (cache.size > 256) cache.clear();
    cache.set(key, v);
  }
  return v;
}

const ready = (what: string) => (onStatus?: (s: EstimatorStatus) => void) => {
  onStatus?.({ phase: 'ready', delegate: 'CPU', message: `Synthetic ${what} estimator ready` });
  return Promise.resolve();
};

export class SyntheticPoseEstimatorV2 implements PoseEstimator {
  readonly id = 'synthetic2';
  readonly label = 'Synthetic two-camera (test) estimator';
  init = ready('pose');
  constructor(
    private readonly cfg: SyntheticViewConfig,
    private readonly delayMs = 0,
  ) {}
  async estimate(_f: unknown, _ts: number, timeSec: number): Promise<PoseEstimate> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    const v = syntheticView(this.cfg, timeSec);
    return { image: v.image.slice(), world: v.world.slice(), people: 1 };
  }
  dispose(): void {}
}

export class SyntheticFaceEstimator implements FaceEstimator {
  readonly id = 'synthetic-face';
  readonly label = 'Synthetic face (test) estimator';
  init = ready('face');
  constructor(private readonly cfg: SyntheticViewConfig) {}
  async estimate(_c: unknown, _ts: number, timeSec: number, ctx: FaceContext): Promise<FaceEstimate | null> {
    const f = syntheticView(this.cfg, timeSec).face;
    if (!f) return null;
    const points: number[] = [];
    for (let i = 0; i < f.points.length; i += 2)
      points.push(...areaToCrop(ctx.window, f.points[i], f.points[i + 1]));
    return { score: f.score, blend: f.blend.slice(), matrix: f.matrix.slice(), points };
  }
  dispose(): void {}
}

export class SyntheticHandEstimator implements HandEstimator {
  readonly id = 'synthetic-hand';
  readonly label = 'Synthetic hand (test) estimator';
  init = ready('hand');
  constructor(private readonly cfg: SyntheticViewConfig) {}
  async estimate(_c: unknown, _ts: number, timeSec: number, ctx: HandContext): Promise<HandEstimate[]> {
    const h = syntheticView(this.cfg, timeSec).hands[ctx.wrist];
    if (!h) return [];
    const image: number[] = [];
    for (let i = 0; i < h.image.length; i += 3) {
      const [x, y] = areaToCrop(ctx.window, h.image[i], h.image[i + 1]);
      image.push(x, y, h.image[i + 2]);
    }
    return [
      {
        score: h.score,
        handedness: h.handedness,
        handednessScore: h.handednessScore,
        image,
        world: h.world.slice(),
      },
    ];
  }
  dispose(): void {}
}
