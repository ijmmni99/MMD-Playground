// MotionClip → babylon-mmd MmdAnimation, built straight from typed arrays (no VMD round-trip).
// Tracks are immutable in the editor, so built tracks are cached per track object: an edit only
// rebuilds the tracks it replaced.
import { MmdAnimation } from 'babylon-mmd/esm/Loader/Animation/mmdAnimation';
import {
  MmdBoneAnimationTrack,
  MmdCameraAnimationTrack,
  MmdMorphAnimationTrack,
  MmdMovableBoneAnimationTrack,
  MmdPropertyAnimationTrack,
} from 'babylon-mmd/esm/Loader/Animation/mmdAnimationTrack';
import type { BoneTrack, CameraKey, MorphTrack, MotionClip, PropertyKey } from '@/lib/motion/types';
import { PHYSICS_OFF } from '@/lib/motion/vmd';

type BuiltBone = MmdBoneAnimationTrack | MmdMovableBoneAnimationTrack;
const boneCache = new WeakMap<BoneTrack, BuiltBone>();
const morphCache = new WeakMap<MorphTrack, MmdMorphAnimationTrack>();
const cameraCache = new WeakMap<readonly CameraKey[], MmdCameraAnimationTrack>();
const propCache = new WeakMap<readonly PropertyKey[], MmdPropertyAnimationTrack>();

/** babylon-mmd's loader: raw 0 = physics on (1), 0x630F = off (0), anything else = 0. */
const physicsToggle = (raw: number | undefined): number => (!raw ? 1 : raw === PHYSICS_OFF ? 0 : 0);

function buildBone(t: BoneTrack): BuiltBone {
  const hit = boneCache.get(t);
  if (hit) return hit;
  const n = t.keys.length;
  const movable = t.keys.some((k) => k.p[0] !== 0 || k.p[1] !== 0 || k.p[2] !== 0);
  let built: BuiltBone;
  if (movable) {
    const m = new MmdMovableBoneAnimationTrack(t.name, n);
    t.keys.forEach((k, i) => {
      m.frameNumbers[i] = k.f;
      m.positions.set(k.p, i * 3);
      for (let c = 0; c < 3; c++) {
        const o = i * 12 + c * 4;
        m.positionInterpolations[o] = k.ip[c * 4];
        m.positionInterpolations[o + 1] = k.ip[c * 4 + 2];
        m.positionInterpolations[o + 2] = k.ip[c * 4 + 1];
        m.positionInterpolations[o + 3] = k.ip[c * 4 + 3];
      }
      m.rotations.set(k.r, i * 4);
      m.rotationInterpolations.set([k.ip[12], k.ip[14], k.ip[13], k.ip[15]], i * 4);
      m.physicsToggles[i] = physicsToggle(k.phys);
    });
    built = m;
  } else {
    const b = new MmdBoneAnimationTrack(t.name, n);
    t.keys.forEach((k, i) => {
      b.frameNumbers[i] = k.f;
      b.rotations.set(k.r, i * 4);
      b.rotationInterpolations.set([k.ip[12], k.ip[14], k.ip[13], k.ip[15]], i * 4);
      b.physicsToggles[i] = physicsToggle(k.phys);
    });
    built = b;
  }
  boneCache.set(t, built);
  return built;
}

function buildMorph(t: MorphTrack): MmdMorphAnimationTrack {
  const hit = morphCache.get(t);
  if (hit) return hit;
  const m = new MmdMorphAnimationTrack(t.name, t.keys.length);
  t.keys.forEach((k, i) => {
    m.frameNumbers[i] = k.f;
    m.weights[i] = k.w;
  });
  morphCache.set(t, m);
  return m;
}

function buildCamera(keys: readonly CameraKey[]): MmdCameraAnimationTrack {
  const hit = cameraCache.get(keys);
  if (hit) return hit;
  const c = new MmdCameraAnimationTrack(keys.length);
  keys.forEach((k, i) => {
    c.frameNumbers[i] = k.f;
    c.positions.set(k.t, i * 3);
    c.rotations.set(k.r, i * 3);
    c.distances[i] = k.d;
    c.fovs[i] = k.fov;
    for (let ch = 0; ch < 3; ch++)
      c.positionInterpolations.set(
        [k.ip[ch * 4], k.ip[ch * 4 + 2], k.ip[ch * 4 + 1], k.ip[ch * 4 + 3]],
        i * 12 + ch * 4,
      );
    c.rotationInterpolations.set([k.ip[12], k.ip[14], k.ip[13], k.ip[15]], i * 4);
    c.distanceInterpolations.set([k.ip[16], k.ip[18], k.ip[17], k.ip[19]], i * 4);
    c.fovInterpolations.set([k.ip[20], k.ip[22], k.ip[21], k.ip[23]], i * 4);
  });
  cameraCache.set(keys, c);
  return c;
}

function buildProps(props: readonly PropertyKey[]): MmdPropertyAnimationTrack {
  const hit = propCache.get(props);
  if (hit) return hit;
  const names = [...new Set(props.flatMap((p) => Object.keys(p.ik)))];
  const track = new MmdPropertyAnimationTrack(props.length, names);
  props.forEach((p, i) => {
    track.frameNumbers[i] = p.f;
    track.visibles[i] = p.visible ? 1 : 0;
    names.forEach((name, j) => {
      const state = track.getIkState(j);
      // Unkeyed IK bones carry the previous state forward (like the loader).
      state[i] = name in p.ik ? (p.ik[name] ? 1 : 0) : i > 0 ? state[i - 1] : 0;
    });
  });
  propCache.set(props, track);
  return track;
}

/** Build a runtime animation for a model (bones, morphs, IK properties) or the camera. */
export function buildMmdAnimation(name: string, clip: MotionClip, target: 'model' | 'camera'): MmdAnimation {
  if (target === 'camera') {
    return new MmdAnimation(name, [], [], [], buildProps([]), buildCamera(clip.camera));
  }
  const bones: MmdBoneAnimationTrack[] = [];
  const movable: MmdMovableBoneAnimationTrack[] = [];
  for (const t of clip.bones) {
    if (!t.keys.length) continue;
    const b = buildBone(t);
    if (b instanceof MmdMovableBoneAnimationTrack) movable.push(b);
    else bones.push(b);
  }
  const morphs = clip.morphs.filter((t) => t.keys.length).map(buildMorph);
  return new MmdAnimation(name, bones, movable, morphs, buildProps(clip.props), buildCamera([]));
}
