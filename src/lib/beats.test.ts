import { describe, expect, it } from 'vitest';
import { estimateBeats, toMono } from './beats';

const SR = 22050;

/** Clicks (short decaying bursts) at a tempo, starting `start` seconds in, over faint noise. */
function clickTrack(bpm: number, start: number, seconds = 24): Float32Array {
  const out = new Float32Array(SR * seconds);
  let seed = 1;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out[i] = (seed / 0xffffffff - 0.5) * 0.01;
  }
  const period = 60 / bpm;
  for (let t = start; t < seconds - 0.1; t += period) {
    const s = Math.round(t * SR);
    for (let j = 0; j < 800; j++) out[s + j] += Math.sin(j * 0.6) * Math.exp(-j / 150) * 0.8;
  }
  return out;
}

describe('estimateBeats', () => {
  for (const bpm of [90, 120, 140]) {
    it(`finds ${bpm} BPM and the first beat`, () => {
      const est = estimateBeats(clickTrack(bpm, 0.3), SR)!;
      expect(est).not.toBeNull();
      expect(Math.abs(est.bpm - bpm)).toBeLessThan(1.5);
      const period = 60 / bpm;
      const expected = 0.3 % period;
      const d = Math.abs(est.firstBeat - expected);
      expect(Math.min(d, period - d)).toBeLessThan(0.04);
      expect(est.confidence).toBeGreaterThan(0.3);
    });
  }

  it('returns null for silence and for very short audio', () => {
    expect(estimateBeats(new Float32Array(SR * 20), SR)).toBeNull();
    expect(estimateBeats(new Float32Array(SR), SR)).toBeNull();
  });
});

describe('toMono', () => {
  it('averages channels and passes mono through', () => {
    const a = new Float32Array([1, 0]);
    expect(toMono([a])).toBe(a);
    expect(Array.from(toMono([a, new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
  });
});
