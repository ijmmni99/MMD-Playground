import type { EstimatorStatus, PoseEstimate, PoseEstimator } from './estimator';
import { syntheticFrame } from './synthetic';

/**
 * Test backend: ignores the pixels and returns the procedural stick-figure dancer for the frame time.
 * Pair it with a video rendered by `drawStickFigure` and the overlay lines up with the picture.
 */
export class SyntheticEstimator implements PoseEstimator {
  readonly id = 'synthetic';
  readonly label = 'Synthetic (test) estimator';

  async init(onStatus?: (s: EstimatorStatus) => void): Promise<void> {
    onStatus?.({ phase: 'ready', delegate: 'CPU', message: 'Synthetic estimator ready' });
  }

  async estimate(_frame: unknown, _timestampMs: number, timeSec: number): Promise<PoseEstimate> {
    const f = syntheticFrame(timeSec);
    return { image: f.image, world: f.world, people: 1 };
  }

  dispose(): void {}
}
