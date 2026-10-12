import { describe, expect, it } from 'vitest';
import { mixLayers, playPlan } from './audioMix';

describe('playPlan', () => {
  const layer = { start: 2, inPoint: 1, duration: 4 };
  it('waits for a layer that has not begun', () => {
    expect(playPlan(layer, 0.5)).toEqual({ delay: 1.5, offset: 1, length: 4 });
  });
  it('joins a layer already playing at the right place in the sound', () => {
    expect(playPlan(layer, 3)).toEqual({ delay: 0, offset: 2, length: 3 });
  });
  it('returns null once the layer has ended', () => {
    expect(playPlan(layer, 6)).toBeNull();
    expect(playPlan(layer, 9)).toBeNull();
    expect(playPlan({ ...layer, duration: 0 }, 0)).toBeNull();
  });
});

describe('mixLayers', () => {
  const ramp = (n: number, v: number): Float32Array => new Float32Array(n).fill(v);

  it('places a layer at its start, trims to its length and applies gain', () => {
    const out = mixLayers(
      [{ channels: [ramp(100, 0.5)], sampleRate: 10, start: 2, inPoint: 0, duration: 3, gain: 0.5 }],
      10,
      10,
    );
    expect(out).toHaveLength(2);
    expect(out[0].length).toBe(100);
    expect(out[0][19]).toBe(0);
    expect(out[0][20]).toBeCloseTo(0.25);
    expect(out[1][49]).toBeCloseTo(0.25);
    expect(out[0][50]).toBe(0);
  });

  it('sums overlapping layers and clamps', () => {
    const l = { channels: [ramp(100, 0.8)], sampleRate: 10, start: 0, inPoint: 0, duration: 5, gain: 1 };
    const out = mixLayers([l, { ...l }], 5, 10);
    expect(out[0][10]).toBe(1);
  });

  it('starts inside the sound at inPoint and resamples to the output rate', () => {
    const src = Float32Array.from({ length: 100 }, (_, i) => i / 100);
    const out = mixLayers(
      [{ channels: [src], sampleRate: 10, start: 0, inPoint: 2, duration: 4, gain: 1 }],
      4,
      20,
    );
    expect(out[0][0]).toBeCloseTo(0.2, 2);
    expect(out[0][20]).toBeCloseTo(0.3, 2);
  });

  it('keeps stereo sides apart', () => {
    const out = mixLayers(
      [
        {
          channels: [ramp(50, 0.2), ramp(50, 0.6)],
          sampleRate: 10,
          start: 0,
          inPoint: 0,
          duration: 4,
          gain: 1,
        },
      ],
      4,
      10,
    );
    expect(out[0][5]).toBeCloseTo(0.2);
    expect(out[1][5]).toBeCloseTo(0.6);
  });
});
