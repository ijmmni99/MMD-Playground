/** Tempo and beat-phase estimation from raw audio, with no dependencies. */

export interface BeatEstimate {
  bpm: number;
  /** Time in seconds of a beat near the start of the audio, 0 <= value < one beat. */
  firstBeat: number;
  /** 0..1: how much stronger the chosen tempo is than the average lag. Low means "don't trust". */
  confidence: number;
}

export interface BeatOptions {
  minBpm?: number;
  maxBpm?: number;
  /** Analyse at most this many seconds from the start. */
  maxSeconds?: number;
}

const HOP = 512;
const WINDOW = 1024;

/** Half-wave rectified change in log energy per hop: large where something new starts. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number, maxSeconds = 90): Float32Array {
  const n = Math.min(samples.length, Math.floor(sampleRate * maxSeconds));
  const frames = Math.max(0, Math.floor((n - WINDOW) / HOP));
  const energy = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const start = i * HOP;
    for (let j = 0; j < WINDOW; j++) {
      const v = samples[start + j];
      sum += v * v;
    }
    energy[i] = Math.log(1 + 1000 * (sum / WINDOW));
  }
  const flux = new Float32Array(frames);
  for (let i = 1; i < frames; i++) flux[i] = Math.max(0, energy[i] - energy[i - 1]);
  // Remove the local mean so steady loud passages don't dominate.
  const out = new Float32Array(frames);
  const half = 20;
  for (let i = 0; i < frames; i++) {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(frames - 1, i + half); k++) {
      s += flux[k];
      c++;
    }
    out[i] = Math.max(0, flux[i] - s / c);
  }
  return out;
}

/** Estimate BPM and first-beat time. Returns null when there is too little audio or no rhythm. */
export function estimateBeats(
  samples: Float32Array,
  sampleRate: number,
  opts: BeatOptions = {},
): BeatEstimate | null {
  const minBpm = opts.minBpm ?? 70;
  const maxBpm = opts.maxBpm ?? 180;
  const env = onsetEnvelope(samples, sampleRate, opts.maxSeconds ?? 90);
  const rate = sampleRate / HOP; // envelope frames per second
  if (env.length < rate * 4) return null;

  const minLag = Math.max(1, Math.floor((60 / maxBpm) * rate));
  const maxLag = Math.ceil((60 / minBpm) * rate);
  if (maxLag >= env.length / 2) return null;

  let total = 0;
  for (const v of env) total += v;
  if (total <= 0) return null;

  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    ac[lag] = s / (env.length - lag);
  }
  // Gentle preference for common dance tempi so half and double time don't tie.
  let best = -1;
  let bestScore = 0;
  let sum = 0;
  let count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * rate) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.8, 2));
    const score = ac[lag] * (0.5 + 0.5 * prior);
    sum += ac[lag];
    count++;
    if (score > bestScore && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
      bestScore = score;
      best = lag;
    }
  }
  if (best < 0) return null;
  // A tempo and its half share peaks; prefer the faster one when it is nearly as strong.
  const half = Math.round(best / 2);
  if (half - 2 >= minLag) {
    let h = half;
    for (let k = half - 2; k <= half + 2; k++) if (ac[k] > ac[h]) h = k;
    if (ac[h] >= 0.5 * ac[best]) best = h;
  }

  const a = ac[best - 1];
  const b = ac[best];
  const c = ac[best + 1];
  const denom = a - 2 * b + c;
  const lagGuess = best + (denom !== 0 ? (0.5 * (a - c)) / denom : 0);

  // Fine search: for each period near the guess, the best phase; keep the strongest comb.
  const comb = (period: number, phase: number): number => {
    let s = 0;
    for (let t = phase; t < env.length - 1; t += period) {
      const i = Math.floor(t);
      const frac = t - i;
      s += env[i] * (1 - frac) + env[i + 1] * frac;
    }
    return s;
  };
  let period = lagGuess;
  let bestPhase = 0;
  let bestSum = -1;
  for (let k = -30; k <= 30; k++) {
    const p = lagGuess * (1 + k * 0.001);
    for (let phase = 0; phase < p; phase += 0.25) {
      const s = comb(p, phase);
      if (s > bestSum) {
        bestSum = s;
        bestPhase = phase;
        period = p;
      }
    }
  }
  const bpm = (60 * rate) / period;
  const mean = sum / count;
  const confidence = mean > 0 ? Math.max(0, Math.min(1, 1 - mean / ac[best])) : 0;
  return {
    bpm, // An envelope frame's energy window ends WINDOW samples after its start, so onsets show up late.
    firstBeat: bestPhase / rate + WINDOW / sampleRate,
    confidence,
  };
}

/** Mono mix of an AudioBuffer-like object. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}
