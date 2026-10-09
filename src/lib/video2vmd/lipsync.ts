// Audio lip-sync: mouth vowels (あいうえお) from the soundtrack instead of the video. Energy drives how
// open the mouth is; energy ratios in three bands (≈ F1 / F2 regions) pick the vowel. Simple and robust
// rather than phonetically exact.
import { attackRelease, VOWELS, type Vowel } from './face';

const BANDS: [number, number][] = [
  [300, 900],
  [900, 2000],
  [2000, 4000],
];

/** In-place iterative radix-2 FFT (re, im of length 2^k). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface LipSyncFrame {
  energy: number;
  /** Band energy fractions (low, mid, high), sum 1. */
  bands: [number, number, number];
}

/** Analyse audio in 20 ms hops (Hann window, 1024-point FFT). */
export function analyseAudio(
  samples: Float32Array,
  sampleRate: number,
  hop = 0.02,
): { times: number[]; frames: LipSyncFrame[] } {
  const N = 1024;
  const step = Math.max(1, Math.round(hop * sampleRate));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const times: number[] = [];
  const frames: LipSyncFrame[] = [];
  const binOf = (hz: number): number => Math.round((hz / sampleRate) * N);
  for (let start = 0; start + N <= samples.length || start === 0; start += step) {
    let e = 0;
    for (let i = 0; i < N; i++) {
      const v = samples[start + i] ?? 0;
      re[i] = v * win[i];
      im[i] = 0;
      e += v * v;
    }
    fft(re, im);
    const band = BANDS.map(([lo, hi]) => {
      let s = 0;
      for (let k = binOf(lo); k <= Math.min(N / 2, binOf(hi)); k++) s += re[k] * re[k] + im[k] * im[k];
      return s;
    });
    const tot = band[0] + band[1] + band[2] || 1;
    times.push((start + N / 2) / sampleRate);
    frames.push({ energy: Math.sqrt(e / N), bands: [band[0] / tot, band[1] / tot, band[2] / tot] });
    if (start + N > samples.length) break;
  }
  return { times, frames };
}

/** Vowel scores for one frame (before scaling by openness). */
export function vowelScores(b: [number, number, number]): Record<Vowel, number> {
  const [L, M, H] = b;
  const raw: Record<Vowel, number> = {
    a: 1.4 * M + 0.5 * L - 0.6 * H,
    i: 1.8 * H - 0.4 * L,
    u: 1.6 * L - 0.8 * M - 0.6 * H,
    e: 1.0 * H + 0.7 * M - 0.6 * L,
    o: 1.0 * L + 0.6 * M - 0.9 * H,
  };
  // Soft-max (temperature 0.15).
  const ex = VOWELS.map((v) => Math.exp(raw[v] / 0.15));
  const sum = ex.reduce((s, x) => s + x, 0);
  return Object.fromEntries(VOWELS.map((v, i) => [v, ex[i] / sum])) as Record<Vowel, number>;
}

/** Vowel weights per output frame time (seconds of the audio), with attack / release smoothing. */
export function lipSyncVowels(
  samples: Float32Array,
  sampleRate: number,
  outTimes: number[],
  fps = 30,
  attack = 0.04,
  release = 0.1,
): Record<Vowel, number[]> {
  const { times, frames } = analyseAudio(samples, sampleRate);
  const energies = frames.map((f) => f.energy).sort((a, b) => a - b);
  const loud = energies[Math.floor(energies.length * 0.95)] || 1e-6;
  const quiet = energies[Math.floor(energies.length * 0.2)] ?? 0;
  const out = Object.fromEntries(VOWELS.map((v) => [v, [] as number[]])) as Record<Vowel, number[]>;
  for (const t of outTimes) {
    let i = 0;
    while (i + 1 < times.length && times[i + 1] <= t) i++;
    const f = frames[i];
    if (!f) {
      for (const v of VOWELS) out[v].push(0);
      continue;
    }
    // Openness: energy above the noise floor, normalised to loud speech / singing.
    const open = Math.max(0, Math.min(1, (f.energy - quiet * 1.5) / Math.max(1e-6, loud - quiet * 1.5)));
    const s = vowelScores(f.bands);
    for (const v of VOWELS) out[v].push(open * s[v]);
  }
  for (const v of VOWELS) out[v] = attackRelease(out[v], fps, attack, release);
  return out;
}
