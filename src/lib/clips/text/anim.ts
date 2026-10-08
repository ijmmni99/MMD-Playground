// Text clip animation timing (pure): in / out animations, idle loops and per-letter effects, as a
// function of the frame inside the clip.

import type { TextIdleAnim, TextInAnim, TextSpec } from '../types';

export interface LetterState {
  dy: number;
  scale: number;
}

export interface TextAnimState {
  visible: boolean;
  opacity: number;
  scale: number;
  /** Offset in text units (× size). */
  offset: [number, number, number];
  /** Radians. */
  rotY: number;
  rotZ: number;
  /** Glyphs drawn (typewriter); ≥ count = all. */
  reveal: number;
  /** Per-letter offsets (wave), or null when every letter is at rest. */
  letters: LetterState[] | null;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const easeOutBounce = (t: number): number => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

/** Apply an entrance at progress t (0 = not yet in, 1 = at rest) to the state. */
function applyAnim(kind: TextInAnim, t: number, s: TextAnimState, glyphs: number, out: boolean): void {
  if (kind === 'none' || t >= 1) return;
  switch (kind) {
    case 'fade':
      s.opacity *= t;
      break;
    case 'pop':
      s.scale *= Math.max(0.001, out ? easeOutCubic(t) : easeOutBack(t));
      s.opacity *= clamp01(t * 3);
      break;
    case 'slide':
      s.offset[0] += (out ? 1 : -1) * (1 - easeOutCubic(t)) * 3;
      s.opacity *= t;
      break;
    case 'typewriter':
      s.reveal = Math.min(s.reveal, Math.floor(t * glyphs + 1e-6));
      break;
    case 'wave': {
      // Letters rise in one after another.
      const spread = 4;
      const letters = s.letters ?? Array.from({ length: glyphs }, () => ({ dy: 0, scale: 1 }));
      for (let i = 0; i < glyphs; i++) {
        const li = clamp01((t * (glyphs + spread) - (out ? glyphs - 1 - i : i)) / spread);
        letters[i].dy += (1 - easeOutBack(li)) * -0.8;
        letters[i].scale *= Math.max(0.001, clamp01(li * 1.5));
      }
      s.letters = letters;
      break;
    }
    case 'spin':
      s.rotY += (1 - easeOutCubic(t)) * Math.PI * (out ? -1 : 1);
      s.scale *= 0.3 + 0.7 * easeOutCubic(t);
      s.opacity *= clamp01(t * 2);
      break;
    case 'drop':
      s.offset[1] += (1 - (out ? easeOutCubic(t) : easeOutBounce(t))) * 4;
      s.opacity *= clamp01(t * 4);
      break;
  }
}

function applyIdle(kind: TextIdleAnim, frame: number, s: TextAnimState): void {
  const w = (2 * Math.PI * frame) / 90;
  if (kind === 'float') s.offset[1] += Math.sin(w) * 0.12;
  else if (kind === 'pulse') s.scale *= 1 + 0.06 * Math.sin(w * 1.5);
  else if (kind === 'wobble') s.rotZ += Math.sin(w) * 0.07;
}

/**
 * State of a text clip `local` frames after its start (`length` frames long). Outside the clip it is
 * invisible. `glyphs` = number of drawn glyphs (typewriter / wave).
 */
export function textAnimState(
  spec: Pick<TextSpec, 'animIn' | 'animInFrames' | 'animOut' | 'animOutFrames' | 'idle'>,
  local: number,
  length: number,
  glyphs: number,
): TextAnimState {
  const s: TextAnimState = {
    visible: local >= 0 && local < length,
    opacity: 1,
    scale: 1,
    offset: [0, 0, 0],
    rotY: 0,
    rotZ: 0,
    reveal: glyphs,
    letters: null,
  };
  if (!s.visible) return s;
  // In and out share the clip when it is short.
  const inF = Math.min(Math.max(0, spec.animInFrames), length / 2);
  const outF = Math.min(Math.max(0, spec.animOutFrames), length / 2);
  if (spec.animIn !== 'none' && inF > 0) applyAnim(spec.animIn, clamp01(local / inF), s, glyphs, false);
  if (spec.animOut !== 'none' && outF > 0)
    applyAnim(spec.animOut, clamp01((length - local) / outF), s, glyphs, true);
  applyIdle(spec.idle, local, s);
  return s;
}
