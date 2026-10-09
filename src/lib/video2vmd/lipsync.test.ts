import { describe, expect, it } from 'vitest';
import { analyseAudio, fft, lipSyncVowels } from './lipsync';

const SR = 11025;
function tones(parts: { dur: number; hz: number[]; amp: number }[]): Float32Array {
  const total = parts.reduce((s, p) => s + p.dur, 0);
  const out = new Float32Array(Math.round(total * SR));
  let o = 0;
  for (const p of parts) {
    const n = Math.round(p.dur * SR);
    for (let i = 0; i < n; i++)
      out[o + i] =
        (p.hz.reduce((s, hz) => s + Math.sin((2 * Math.PI * hz * (o + i)) / SR), 0) * p.amp) /
        Math.max(1, p.hz.length);
    o += n;
  }
  return out;
}

describe('audio lip-sync', () => {
  it('FFT finds a pure tone', () => {
    const N = 256;
    const re = new Float64Array(N).map((_, i) => Math.cos((2 * Math.PI * 8 * i) / N));
    const im = new Float64Array(N);
    fft(re, im);
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]));
    expect(mags.indexOf(Math.max(...mags.slice(0, N / 2)))).toBe(8);
  });

  it('silence closes the mouth; band balance picks the vowel', () => {
    const audio = tones([
      { dur: 0.6, hz: [], amp: 0 },
      { dur: 0.6, hz: [3000], amp: 0.5 },
      { dur: 0.6, hz: [450], amp: 0.5 },
      { dur: 0.6, hz: [1300], amp: 0.5 },
    ]);
    const frames = analyseAudio(audio, SR).frames;
    expect(frames.length).toBeGreaterThan(80);
    const times = Array.from({ length: 72 }, (_, i) => i / 30);
    const v = lipSyncVowels(audio, SR, times);
    const at = (t: number) => {
      const f = Math.round(t * 30);
      return { a: v.a[f], i: v.i[f], u: v.u[f], e: v.e[f], o: v.o[f] };
    };
    const silent = at(0.3);
    expect(Math.max(...Object.values(silent))).toBeLessThan(0.05);
    const hi = at(1.0);
    expect(hi.i).toBeGreaterThan(Math.max(hi.a, hi.u, hi.o));
    const lo = at(1.6);
    expect(Math.max(lo.u, lo.o)).toBeGreaterThan(Math.max(lo.i, lo.e));
    const mid = at(2.2);
    expect(mid.a).toBeGreaterThan(Math.max(mid.i, mid.u));
  });
});
