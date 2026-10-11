import { HAND_PRESETS, type HandPresetId } from '@/lib/video2vmd/handPose';
import { fingerRig, fingerRotations, type RigBone } from '@/lib/video2vmd/hands';
import { setBoneKey } from './edit';
import type { MotionClip } from './types';

export type HandSide = 'left' | 'right' | 'both';

/**
 * Key every finger bone of a hand preset at frame `f`. Bones the model lacks are skipped; a side
 * whose hand bones are missing is left alone. Returns the same clip when nothing could be keyed.
 */
export function keyHandPreset(
  clip: MotionClip,
  skeleton: readonly RigBone[],
  side: HandSide,
  preset: HandPresetId,
  f: number,
): MotionClip {
  const sides = side === 'both' ? (['left', 'right'] as const) : ([side] as const);
  let out = clip;
  for (const s of sides) {
    const rig = fingerRig([...skeleton], s);
    if (!rig) continue;
    for (const [bone, q] of fingerRotations(rig, HAND_PRESETS[preset])) {
      out = setBoneKey(out, bone, { f, p: [0, 0, 0], r: [q[0], q[1], q[2], q[3]] });
    }
  }
  return out;
}
