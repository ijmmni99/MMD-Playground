import { LANDMARK_COUNT, MIRROR_INDEX } from './landmarks';
import type { Vec3 } from './math';

/**
 * MediaPipe world landmarks → MMD axes (metres, not yet scaled).
 *
 * MediaPipe world space is right-handed: x → image right, y → down, z → away from the camera, origin at
 * the hip centre. MMD is left-handed: x → the model's left (screen right when it faces the camera),
 * y → up, z → away from the default camera (the model faces −Z). For a dancer facing the camera the
 * dancer's left side is on image-right, so only Y flips: (x, y, z) → (x, −y, z).
 *
 * `mirror` handles selfie-flipped videos: the person appears with sides swapped, so negate x.
 * (Swapping the left/right landmark labels is done separately with {@link mirrorIndex}.)
 */
export function mpWorldToMmd(x: number, y: number, z: number, mirror = false): Vec3 {
  return [mirror ? -x : x, -y, z];
}

/** Image coordinates (normalised, y down) → normalised, accounting for mirroring. */
export function mpImageToNormalized(x: number, y: number, mirror = false): [number, number] {
  return [mirror ? 1 - x : x, y];
}

/** Landmark index to read for output landmark `i` (swaps sides when mirrored). */
export const mirrorIndex = (i: number, mirror: boolean): number => (mirror ? MIRROR_INDEX[i] : i);

/** Convert one frame of MediaPipe world landmarks (33 × [x, y, z, vis]) to MMD-axis points + visibility. */
export function convertWorldFrame(
  world: ArrayLike<number>,
  mirror: boolean,
): { points: Vec3[]; visibility: number[] } {
  const points: Vec3[] = [];
  const visibility: number[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const src = mirrorIndex(i, mirror) * 4;
    points.push(mpWorldToMmd(world[src], world[src + 1], world[src + 2], mirror));
    visibility.push(world[src + 3]);
  }
  return { points, visibility };
}
