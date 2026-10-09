import { describe, expect, it } from 'vitest';
import type { FrameSource } from './frameSource';
import { detectPoses, pickHand, type DetectRequest } from './pipeline';
import { DEFAULT_SYNTHETIC_VIEW, syntheticView } from './syntheticV2';

function fakeSource(seconds: number, fps: number): FrameSource {
  const dummy = { width: 640, height: 360 } as unknown as OffscreenCanvas;
  return {
    kind: 'seek',
    size: [640, 360],
    sourceSize: [1920, 1080],
    async *frames(range) {
      for (let t = range.start; t < Math.min(range.end, seconds) - 1e-6; t += 1 / fps) {
        yield { time: t, canvas: dummy, crop: () => dummy };
      }
    },
    dispose() {},
  };
}

const request = (features: DetectRequest['features']): DetectRequest => ({
  file: new Blob(),
  info: { name: 'v.webm', width: 640, height: 360, fps: 30, duration: 1, hasAudio: false },
  trim: [0, 1],
  crop: null,
  maxLongEdge: 640,
  sampleFps: 30,
  estimator: 'synthetic2',
  wasmBase: '',
  modelUrl: '',
  preferGpu: false,
  features,
  synthetic: DEFAULT_SYNTHETIC_VIEW,
});

describe('crop pass', () => {
  it('runs face and hand estimators on tracked crops and maps their landmarks back', async () => {
    const { sequence } = await detectPoses(
      request({ face: true, hands: true }),
      fakeSource(1, 30),
      { onStatus: () => {}, onProgress: () => {}, onFrame: () => {} },
      new AbortController().signal,
    );
    expect(sequence.frames.length).toBe(30);
    const withFace = sequence.frames.filter((f) => f.face).length;
    const withHands = sequence.frames.filter((f) => f.hands?.[0] && f.hands?.[1]).length;
    expect(withFace).toBe(30);
    expect(withHands).toBe(30);
    const f = sequence.frames[12];
    const truth = syntheticView(DEFAULT_SYNTHETIC_VIEW, f.time);
    f.face!.points.forEach((v, i) => expect(v).toBeCloseTo(truth.face!.points[i], 6));
    expect(f.hands![1]!.image[24]).toBeCloseTo(truth.hands[1]!.image[24], 6);
    // The crop window holds the hand.
    const c = f.hands![0]!.crop;
    expect(f.hands![0]!.image[0]).toBeGreaterThan(c.x);
    expect(f.hands![0]!.image[0]).toBeLessThan(c.x + c.w);
  });

  it('skips the crop pass when no feature is on', async () => {
    const { sequence } = await detectPoses(
      request(undefined),
      fakeSource(0.2, 30),
      { onStatus: () => {}, onProgress: () => {}, onFrame: () => {} },
      new AbortController().signal,
    );
    expect(sequence.frames.every((f) => f.face === undefined && f.hands === undefined)).toBe(true);
  });

  it('keeps the hand at the body wrist when the crop holds both hands', () => {
    const win = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    const hand = (x: number) => ({
      score: 0.9,
      handedness: 'Left',
      handednessScore: 0.9,
      image: Array.from({ length: 63 }, (_, i) => (i % 3 === 0 ? x : 0.5)),
      world: new Array(63).fill(0),
    });
    // Body wrist at area x = 0.45 → crop x = 0.25.
    const picked = pickHand([hand(0.9), hand(0.25)], win, [0.45, 0.5]);
    expect(picked!.image[0]).toBeCloseTo(0.45);
    expect(pickHand([hand(0.95)], { ...win, w: 0.02, h: 0.02 }, [0.1, 0.1])).toBeNull();
  });
});
