import { describe, expect, it } from 'vitest';
import type { PoseFrame } from '@/engine/video2vmd/types';
import { audioSync, crossCorrelate, motionSync, onsetEnvelope } from './sync';
import { fixtureCameras, syntheticScene, viewFrame } from './synthetic';

/** Noise floor + claps (short bursts) at the given times. */
function claps(duration: number, sr: number, at: number[], seed = 1): Float32Array {
  const out = new Float32Array(Math.round(duration * sr));
  let s = seed;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
  for (let i = 0; i < out.length; i++) out[i] = rnd() * 0.01 + Math.sin(i * 0.05) * 0.005;
  for (const t of at) {
    const i0 = Math.round(t * sr);
    for (let i = 0; i < sr * 0.03 && i0 + i < out.length; i++)
      out[i0 + i] += rnd() * Math.exp(-i / (sr * 0.006));
  }
  return out;
}

describe('time sync', () => {
  it('cross-correlation finds a known lag with sub-sample precision', () => {
    const a = Array.from({ length: 400 }, (_, i) => Math.sin(i / 7) + Math.sin(i / 3.1) * 0.5);
    const b = a.map((_, i) => Math.sin((i - 12.4) / 7) + Math.sin((i - 12.4) / 3.1) * 0.5);
    const r = crossCorrelate(a, b, 60);
    expect(r.lag).toBeCloseTo(12.4, 0);
    expect(r.peak).toBeGreaterThan(0.95);
  });

  it('onset envelope peaks at a clap', () => {
    const sr = 11025;
    const env = onsetEnvelope(claps(2, sr, [1.0]), sr);
    const max = env.indexOf(Math.max(...env));
    expect(Math.abs(max - 100)).toBeLessThanOrEqual(1);
  });

  it('audio sync recovers a known offset (clap at the start, music-like hits after)', () => {
    const hits = [0.8, 2.1, 2.9, 3.35, 4.6, 5.2, 6.75];
    // The side camera started 1.37 s earlier: every event happens 1.37 s later in its recording.
    const front = claps(8, 11025, hits, 3);
    const side = claps(
      9.5,
      16000,
      hits.map((t) => t + 1.37),
      9,
    );
    const r = audioSync({ samples: front, sampleRate: 11025 }, { samples: side, sampleRate: 16000 });
    expect(r.offset).toBeCloseTo(1.37, 1);
    expect(Math.abs(r.offset - 1.37)).toBeLessThan(0.015);
    expect(r.confidence).toBeGreaterThan(0.5);
    // Negative offsets work too.
    const r2 = audioSync({ samples: side, sampleRate: 16000 }, { samples: front, sampleRate: 11025 });
    expect(r2.offset).toBeCloseTo(-1.37, 1);
  });

  it('audio sync of unrelated noise has low confidence', () => {
    const r = audioSync(
      { samples: claps(5, 11025, [], 4), sampleRate: 11025 },
      { samples: claps(5, 11025, [], 5), sampleRate: 11025 },
    );
    expect(r.confidence).toBeLessThan(0.3);
  });

  it('motion sync recovers the offset from the hip bounce of two views', () => {
    const [front, side] = fixtureCameras(90);
    const offset = 0.6;
    const seq = (cam: typeof front, shift: number, fps: number, dur: number): PoseFrame[] =>
      Array.from({ length: Math.round(dur * fps) }, (_, i) => {
        const tLocal = i / fps;
        const v = viewFrame(syntheticScene(tLocal - shift, { depthHeavy: true, hops: true }), {
          camera: cam,
        });
        return { time: tLocal, detected: true, image: v.image, world: v.world };
      });
    const r = motionSync(seq(front, 0, 30, 9), seq(side, offset, 25, 10), 30);
    expect(Math.abs(r.offset - offset)).toBeLessThan(1 / 30);
    expect(r.confidence).toBeGreaterThan(0.3);
  });
});
