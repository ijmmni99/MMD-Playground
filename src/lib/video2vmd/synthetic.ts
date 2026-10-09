// Synthetic ground truth for v2 tests and the e2e "mock" estimators: the procedural stick-figure dancer
// (src/engine/video2vmd/synthetic.ts) plus fingers, a face (blendshapes, gaze, head yaw) and any number of
// virtual pinhole cameras. Each camera produces MediaPipe-format observations with monocular depth error,
// so two-view fusion has something real to fix.
import { syntheticPose } from '@/engine/video2vmd/synthetic';
import { LANDMARK_COUNT, LM } from '@/engine/video2vmd/landmarks';
import {
  add,
  axisAngle,
  cross,
  mid,
  normalize,
  qmul,
  rotate,
  scale,
  sub,
  type Quat,
  type Vec3,
} from '@/lib/math3d';
import { project, toCameraFrame, worldToCam, type PinholeCamera } from './camera';
import { HAND_PRESETS, lerpHandPose, type HandPose, type HandPresetId } from './handPose';
import {
  BLENDSHAPES,
  BLEND_INDEX,
  FACE_POINT_KEYS,
  FINGERS,
  HAND_POINTS,
  type Blendshape,
  type FaceObs,
  type FacePoint,
  type HandObs,
  type HandPair,
} from './types';

const RAD = Math.PI / 180;

export interface SceneOptions {
  /** Swing the arms forward / back (motion mostly along the front camera's depth axis). */
  depthHeavy?: boolean;
}

export interface SyntheticScene {
  t: number;
  /** 33 body joints, MMD axes, metres, floor y = 0. */
  body: Vec3[];
  contact: [boolean, boolean];
  /** Head yaw (radians, about +Y). */
  headYaw: number;
  /** Ground-truth hand poses [left, right] (the dancer's own sides). */
  handPose: [HandPose, HandPose];
  /** 21 hand points per side, world. */
  hands: [Vec3[], Vec3[]];
  /** Ground-truth blendshapes (BLENDSHAPES order). */
  blend: number[];
  /** Gaze relative to the head: [yaw toward the dancer's left (+X), pitch up] in radians. */
  gaze: [number, number];
  /** Key face points in the world. */
  face: Record<FacePoint, Vec3>;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Hand pose schedule: open → fist → point → peace, one second each, 0.25 s transitions. */
export function handPoseAt(t: number): HandPose {
  const seq: HandPresetId[] = ['open', 'fist', 'point', 'peace'];
  const u = ((t % 4) + 4) % 4;
  const k = Math.floor(u);
  const a = HAND_PRESETS[seq[k]];
  const b = HAND_PRESETS[seq[(k + 1) % seq.length]];
  return lerpHandPose(a, b, smooth((u - k - 0.75) / 0.25));
}

/** Vowel schedule (for blendshapes): a, i, u, e, o, rest; 0.4 s each. */
export const VOWEL_SEQUENCE = ['a', 'i', 'u', 'e', 'o', 'rest'] as const;
export function vowelAt(t: number): (typeof VOWEL_SEQUENCE)[number] {
  const k = Math.floor((((t % 2.4) + 2.4) % 2.4) / 0.4);
  return VOWEL_SEQUENCE[k];
}

/** Blinks: 0.12 s (≈ 4 frames) every 1.3 s, starting at 0.5 s. */
export const blinkAt = (t: number): boolean => {
  const u = (t - 0.5) % 1.3;
  return t >= 0.5 && u >= 0 && u < 0.12;
};

export function blendshapesAt(t: number): number[] {
  const b = new Array<number>(BLENDSHAPES.length).fill(0);
  const set = (n: Blendshape, v: number): void => void (b[BLEND_INDEX[n]] = v);
  const v = vowelAt(t);
  const shapes: Record<string, Partial<Record<Blendshape, number>>> = {
    a: { jawOpen: 0.8 },
    i: {
      mouthSmileLeft: 0.7,
      mouthSmileRight: 0.7,
      mouthStretchLeft: 0.5,
      mouthStretchRight: 0.5,
      jawOpen: 0.1,
    },
    u: { mouthPucker: 0.85, jawOpen: 0.1 },
    e: { mouthStretchLeft: 0.75, mouthStretchRight: 0.75, jawOpen: 0.5 },
    o: { mouthFunnel: 0.75, jawOpen: 0.6 },
    rest: { mouthClose: 0.3 },
  };
  for (const [k, val] of Object.entries(shapes[v])) set(k as Blendshape, val!);
  const blink = blinkAt(t) ? 1 : 0.05;
  set('eyeBlinkLeft', blink);
  set('eyeBlinkRight', blink);
  // Brows: raise around 1.6–2.0 s of every 3 s, frown around 2.4–2.8 s.
  const u3 = ((t % 3) + 3) % 3;
  if (u3 > 1.6 && u3 < 2.0) {
    set('browInnerUp', 0.7);
    set('browOuterUpLeft', 0.7);
    set('browOuterUpRight', 0.7);
    set('eyeWideLeft', 0.6);
    set('eyeWideRight', 0.6);
  }
  if (u3 > 2.4 && u3 < 2.8) {
    set('browDownLeft', 0.8);
    set('browDownRight', 0.8);
  }
  return b;
}

export const gazeAt = (t: number): [number, number] => [
  0.3 * Math.sin((2 * Math.PI * t) / 2.3),
  0.15 * Math.sin((2 * Math.PI * t) / 3.1),
];

const SEG: Record<'thumb' | 'finger', [number, number, number]> = {
  thumb: [0.04, 0.032, 0.028],
  finger: [0.04, 0.025, 0.02],
};
const MCP: Record<Exclude<(typeof FINGERS)[number], 'thumb'>, [number, number]> = {
  index: [0.085, 0.025],
  middle: [0.09, 0.008],
  ring: [0.085, -0.009],
  little: [0.075, -0.024],
};
const MCP_INDEX = { index: 5, middle: 9, ring: 13, little: 17 } as const;

/**
 * 21 hand points (MediaPipe topology) for a hand at `wrist`, pointing along `h`, thumb / index toward `a`.
 * Fingers curl toward the palm normal `n` (left: a × h, right: h × a — palms face the same way when the
 * arms mirror each other).
 */
export function handPoints(wrist: Vec3, h: Vec3, a: Vec3, side: 'left' | 'right', pose: HandPose): Vec3[] {
  const n = normalize(side === 'left' ? cross(a, h) : cross(h, a));
  const pts: Vec3[] = new Array(HAND_POINTS);
  pts[0] = wrist;
  const chain = (start: Vec3, dir0: Vec3, flex: number[], lens: number[], out: number[]): void => {
    const k = normalize(cross(dir0, n));
    let p = start;
    let total = 0;
    lens.forEach((len, i) => {
      total += flex[i] * RAD;
      p = add(p, scale(rotate(axisAngle(k, total), dir0), len));
      pts[out[i]] = p;
    });
  };
  for (const fname of ['index', 'middle', 'ring', 'little'] as const) {
    const [along, across] = MCP[fname];
    const mcp = add(wrist, add(scale(h, along), scale(a, across)));
    const idx = MCP_INDEX[fname];
    pts[idx] = mcp;
    const meta = normalize(sub(mcp, wrist));
    const spread = rotate(axisAngle(n, -pose[fname].spread * RAD * (side === 'left' ? 1 : -1)), meta);
    chain(mcp, spread, pose[fname].flex, SEG.finger, [idx + 1, idx + 2, idx + 3]);
  }
  // Thumb: CMC near the wrist on the index side; the metacarpal points between h and a, and opposition
  // tilts it toward the palm normal.
  const cmc = add(wrist, add(scale(h, 0.02), scale(a, 0.02)));
  pts[1] = cmc;
  const base = normalize(add(h, scale(a, 0.9)));
  const kOpp = normalize(cross(base, n));
  const metaDir = rotate(axisAngle(kOpp, pose.thumb.flex[0] * RAD), base);
  const mcp = add(cmc, scale(metaDir, SEG.thumb[0]));
  pts[2] = mcp;
  chain(mcp, metaDir, [pose.thumb.flex[1], pose.thumb.flex[2]], [SEG.thumb[1], SEG.thumb[2]], [3, 4]);
  return pts;
}

/** Face points for a head centre, head rotation, gaze and blendshapes. */
function facePoints(headC: Vec3, q: Quat, gaze: [number, number], blend: number[]): Record<FacePoint, Vec3> {
  const at = (v: Vec3): Vec3 => add(headC, rotate(q, v));
  const bv = (n: Blendshape): number => blend[BLEND_INDEX[n]];
  const lid = (blink: number): number => 0.006 * (1 - blink);
  // Eye A = the dancer's right eye (−X), eye B = left (+X).
  const eye = (x: number, blink: number): { c: Vec3; top: Vec3; bottom: Vec3; iris: Vec3 } => {
    const c: Vec3 = [x, 0.05, -0.09];
    return {
      c,
      top: add(c, [0, lid(blink), 0]),
      bottom: add(c, [0, -0.004, 0]),
      // Iris offset in the eye: ±1 of the half width (0.015) maps to ±25° yaw, ±0.006 to ±20° pitch.
      iris: add(c, [(0.015 * gaze[0]) / (25 * RAD), (0.006 * gaze[1]) / (20 * RAD), 0]),
    };
  };
  const ea = eye(-0.03, bv('eyeBlinkRight'));
  const eb = eye(0.03, bv('eyeBlinkLeft'));
  const jaw = bv('jawOpen');
  const p: Record<FacePoint, Vec3> = {
    aOuter: at([-0.045, 0.05, -0.085]),
    aInner: at([-0.015, 0.05, -0.09]),
    aTop: at(ea.top),
    aBottom: at(ea.bottom),
    aIris: at(ea.iris),
    bOuter: at([0.045, 0.05, -0.085]),
    bInner: at([0.015, 0.05, -0.09]),
    bTop: at(eb.top),
    bBottom: at(eb.bottom),
    bIris: at(eb.iris),
    mouthA: at([-0.025, -0.03, -0.09]),
    mouthB: at([0.025, -0.03, -0.09]),
    lipTop: at([0, -0.025, -0.095]),
    lipBottom: at([0, -0.035 - 0.02 * jaw, -0.095]),
    noseTip: at([0, 0.02, -0.105]),
    chin: at([0, -0.075 - 0.015 * jaw, -0.07]),
    forehead: at([0, 0.12, -0.08]),
    browA: at([-0.03, 0.075 + 0.01 * bv('browOuterUpRight'), -0.09]),
    browB: at([0.03, 0.075 + 0.01 * bv('browOuterUpLeft'), -0.09]),
  };
  return p;
}

/** Ground truth at time t (performance time). */
export function syntheticScene(t: number, o: SceneOptions = {}): SyntheticScene {
  const { joints, contact, headYaw } = syntheticPose(t);
  const body = joints.map((p) => [...p] as Vec3);
  const forearmEnds = {} as Record<'left' | 'right', { wrist: Vec3; h: Vec3; a: Vec3 }>;
  for (const side of ['left', 'right'] as const) {
    const L =
      side === 'left'
        ? {
            sh: LM.leftShoulder,
            el: LM.leftElbow,
            wr: LM.leftWrist,
            ix: LM.leftIndex,
            pk: LM.leftPinky,
            th: LM.leftThumb,
          }
        : {
            sh: LM.rightShoulder,
            el: LM.rightElbow,
            wr: LM.rightWrist,
            ix: LM.rightIndex,
            pk: LM.rightPinky,
            th: LM.rightThumb,
          };
    if (o.depthHeavy) {
      // Swing the whole arm about the shoulder's lateral axis: big forward / backward reaches.
      const swing = axisAngle(
        [1, 0, 0],
        1.1 * Math.sin((2 * Math.PI * t) / 1.6 + (side === 'left' ? 0 : Math.PI)),
      );
      const s = body[L.sh];
      for (const i of [L.el, L.wr, L.ix, L.pk, L.th]) body[i] = add(s, rotate(swing, sub(body[i], s)));
    }
    const wrist = body[L.wr];
    const h = normalize(sub(body[L.wr], body[L.el]));
    const across = sub(body[L.ix], body[L.pk]);
    const a = normalize(
      sub(across, scale(h, across[0] * h[0] + across[1] * h[1] + across[2] * h[2])),
      [0, 0, -1],
    );
    forearmEnds[side] = { wrist, h, a };
  }
  const poseL = handPoseAt(t);
  const poseR = handPoseAt(t + 0.5);
  const hands: [Vec3[], Vec3[]] = [
    handPoints(forearmEnds.left.wrist, forearmEnds.left.h, forearmEnds.left.a, 'left', poseL),
    handPoints(forearmEnds.right.wrist, forearmEnds.right.h, forearmEnds.right.a, 'right', poseR),
  ];
  // Body hand landmarks follow the generated hands.
  body[LM.leftIndex] = hands[0][5];
  body[LM.leftPinky] = hands[0][17];
  body[LM.leftThumb] = hands[0][4];
  body[LM.rightIndex] = hands[1][5];
  body[LM.rightPinky] = hands[1][17];
  body[LM.rightThumb] = hands[1][4];
  const blend = blendshapesAt(t);
  const gaze = gazeAt(t);
  const headC = add(mid(body[LM.leftEar], body[LM.rightEar]), [0, 0, 0]);
  const q = axisAngle([0, 1, 0], headYaw);
  return {
    t,
    body,
    contact,
    headYaw,
    handPose: [poseL, poseR],
    hands,
    blend,
    gaze,
    face: facePoints(headC, q, gaze, blend),
  };
}

export interface ViewOptions {
  camera: PinholeCamera;
  /** Monocular depth error: camera-depth offsets are scaled by this (MediaPipe under-estimates depth). */
  depthScale?: number;
  /** Amplitude (metres) of smooth per-landmark depth noise. */
  depthNoise?: number;
  /** Amplitude (metres) of x / y noise. */
  noise?: number;
}

/** One frame as a MediaPipe-style estimator would see it from a camera. */
export interface ViewFrame {
  /** 33 × [x, y, z, visibility], normalised image coordinates. */
  image: Float32Array;
  /** 33 × [x, y, z, visibility], hip-centred metres, MediaPipe camera axes (y down, z away). */
  world: Float32Array;
  face: FaceObs | null;
  hands: HandPair;
}

const wobble = (t: number, i: number, k: number): number =>
  Math.sin(1.7 * t + i * 1.3 + k * 2.1) * 0.6 + Math.sin(0.63 * t + i * 0.7 + k) * 0.4;

/** MediaPipe face transformation matrix (column-major; camera space x right, y up, z toward the viewer). */
function faceMatrix(camYawDeg: number, headYaw: number, pos: Vec3): number[] {
  // Head rotation in the camera's MMD-axis frame, then S·R·S with S = diag(1, 1, −1).
  // Camera rotation R_y(θ) is −θ about +Y; its inverse (world → camera) is +θ.
  const qCam = qmul(axisAngle([0, 1, 0], camYawDeg * RAD), axisAngle([0, 1, 0], headYaw));
  const col = (v: Vec3): Vec3 => {
    const r = rotate(qCam, [v[0], v[1], -v[2]]);
    return [r[0], r[1], -r[2]];
  };
  const x = col([1, 0, 0]);
  const y = col([0, 1, 0]);
  const z = col([0, 0, 1]);
  return [
    x[0],
    x[1],
    x[2],
    0,
    y[0],
    y[1],
    y[2],
    0,
    z[0],
    z[1],
    z[2],
    0,
    pos[0] * 100,
    pos[1] * 100,
    -pos[2] * 100,
    1,
  ];
}

/** Render one scene through one camera. */
export function viewFrame(scene: SyntheticScene, o: ViewOptions): ViewFrame {
  const cam = o.camera;
  const depthScale = o.depthScale ?? 0.55;
  const depthNoise = o.depthNoise ?? 0.04;
  const noise = o.noise ?? 0.004;
  const P = scene.body;
  const hip = mid(P[LM.leftHip], P[LM.rightHip]);
  const hipCam = worldToCam(cam.yawDeg, hip);
  const image = new Float32Array(LANDMARK_COUNT * 4);
  const world = new Float32Array(LANDMARK_COUNT * 4);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const rel = sub(worldToCam(cam.yawDeg, P[i]), hipCam);
    // Hidden behind the torso from this camera: low visibility.
    const behind = rel[2] > 0.06 && Math.abs(rel[0]) < 0.12 && rel[1] > -0.1 && rel[1] < 0.6;
    const vis = behind ? 0.25 : 0.98;
    world[i * 4] = rel[0] + noise * wobble(scene.t, i, 0);
    world[i * 4 + 1] = -(rel[1] + noise * wobble(scene.t, i, 1));
    world[i * 4 + 2] = rel[2] * depthScale + depthNoise * wobble(scene.t, i, 2);
    world[i * 4 + 3] = vis;
    const [u, v, z] = project(cam, P[i]);
    image.set([u, v, z - toCameraFrame(cam, hip)[2], vis], i * 4);
  }
  // Face: visible when it turns toward the camera.
  // Facing a camera at yaw θ means a head yaw of −θ.
  const faceYawToCam = scene.headYaw + cam.yawDeg * RAD;
  const frontal = Math.cos(faceYawToCam);
  let face: FaceObs | null = null;
  if (frontal > 0.35) {
    const pts: number[] = [];
    for (const k of FACE_POINT_KEYS) {
      const [u, v] = project(cam, scene.face[k]);
      pts.push(u, v);
    }
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const size =
      Math.max(
        Math.max(...xs) - Math.min(...xs),
        (Math.max(...ys) - Math.min(...ys)) * (cam.size[1] / cam.size[0]),
      ) * 1.8;
    face = {
      score: Math.min(0.99, 0.4 + frontal * 0.6),
      blend: scene.blend.slice(),
      matrix: faceMatrix(cam.yawDeg, scene.headYaw, toCameraFrame(cam, scene.face.noseTip)),
      points: pts,
      crop: {
        x: cx - size / 2,
        y: cy - (size * cam.size[0]) / cam.size[1] / 2,
        w: size,
        h: (size * cam.size[0]) / cam.size[1],
      },
    };
  }
  const hands: HandPair = [null, null];
  scene.hands.forEach((pts, k) => {
    const centre = pts.reduce((acc, p) => add(acc, scale(p, 1 / pts.length)), [0, 0, 0] as Vec3);
    const cc = worldToCam(cam.yawDeg, centre);
    const img: number[] = [];
    const w: number[] = [];
    for (const [i, p] of pts.entries()) {
      const [u, v, z] = project(cam, p);
      img.push(u, v, z - toCameraFrame(cam, centre)[2]);
      const rel = sub(worldToCam(cam.yawDeg, p), cc);
      w.push(rel[0] + 0.001 * wobble(scene.t, i, 3), -rel[1], rel[2] * 0.8 + 0.003 * wobble(scene.t, i, 4));
    }
    const xs = img.filter((_, i) => i % 3 === 0);
    const ys = img.filter((_, i) => i % 3 === 1);
    const s = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.6;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const obs: HandObs = {
      score: 0.95,
      // MediaPipe labels hands as if the image were mirrored: an unmirrored left hand reads "Right".
      handedness: k === 0 ? 'Right' : 'Left',
      handednessScore: 0.9,
      image: img,
      world: w,
      crop: { x: cx - s / 2, y: cy - s / 2, w: s, h: s },
    };
    hands[k] = obs;
  });
  return { image, world, face, hands };
}

/** Front + side cameras of the standard two-view fixture. */
export function fixtureCameras(
  sideYawDeg = 90,
  size: [number, number] = [640, 360],
): [PinholeCamera, PinholeCamera] {
  const focal = 0.9 * Math.max(size[0], size[1]);
  return [
    { yawDeg: 0, distance: 4, height: 1, size, focal },
    { yawDeg: sideYawDeg, distance: 4, height: 1, size, focal },
  ];
}
