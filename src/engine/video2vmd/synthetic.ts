// Procedural stick-figure dancer that produces MediaPipe-format landmarks with a known ground truth.
// Used by unit tests (retargeting, contacts) and by the e2e "synthetic" pose estimator.
import { LANDMARK_COUNT, LM } from './landmarks';
import { add, axisAngle, cross, dist, normalize, rotate, scale, sub, type Vec3 } from './math';

export interface SyntheticOptions {
  /** Seconds per step-touch cycle. */
  period?: number;
  /** Side travel of the hips (metres). */
  sway?: number;
  /** Torso yaw amplitude (radians). */
  yaw?: number;
  /** Elbow bend range (radians). */
  elbow?: number;
  /** Simulated camera distance (metres) and image size. */
  cameraDistance?: number;
  imageSize?: [number, number];
  /** Add gaussian-ish noise (metres) to the world landmarks. */
  noise?: number;
  /** Mirror the output like a selfie camera would. */
  mirror?: boolean;
}

export interface SyntheticFrame {
  /** MediaPipe world landmarks (x right, y down, z away; hip-centred metres) + visibility, 33 × 4. */
  world: Float32Array;
  /** MediaPipe image landmarks (normalised) + visibility, 33 × 4. */
  image: Float32Array;
  /** Ground truth in MMD axes (metres, floor at y = 0). */
  truth: Vec3[];
  /** Ground-truth foot contact flags [left, right]. */
  contact: [boolean, boolean];
}

const HIP_W = 0.1;
const SHOULDER_W = 0.19;
const TORSO = 0.5;
const THIGH = 0.43;
const SHIN = 0.42;
const ANKLE_H = 0.08;
const UPPER_ARM = 0.29;
const FOREARM = 0.26;
const HAND = 0.08;

/** Two-bone IK: knee position for hip → ankle with the knee bending toward `pole`. */
function twoBone(hip: Vec3, ankle: Vec3, l1: number, l2: number, pole: Vec3): Vec3 {
  const d = Math.min(dist(hip, ankle), l1 + l2 - 1e-4);
  const dir = normalize(sub(ankle, hip));
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const side = normalize(sub(pole, scale(dir, pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2])));
  return add(add(hip, scale(dir, a)), scale(side, h));
}

/** Smooth 0→1 ramp. */
const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * A step-touch dance: weight shifts side to side, one foot planted while the other lifts and steps.
 * Returns ground-truth joint positions in MMD axes (metres, floor y = 0, facing −Z).
 */
export function syntheticPose(
  t: number,
  o: SyntheticOptions = {},
): { joints: Vec3[]; contact: [boolean, boolean] } {
  const period = o.period ?? 1.2;
  const sway = o.sway ?? 0.18;
  const yawAmp = o.yaw ?? 0.35;
  const elbowAmp = o.elbow ?? 1.2;
  const cycle = t / period;
  const k = Math.floor(cycle);
  const u = cycle - k; // phase within the half-cycle pair
  // Even cycles: weight moves to the left foot (right foot steps); odd: to the right.
  const leftSupport = k % 2 === 0;
  const stance = 0.16; // half distance between feet when both planted
  // Foot positions (x, z) — the swinging foot lifts during u in [0.2, 0.8].
  const plantedL: Vec3 = [stance, ANKLE_H, 0];
  const plantedR: Vec3 = [-stance, ANKLE_H, 0];
  const swingPhase = ease((u - 0.2) / 0.6);
  const lift = Math.sin(Math.PI * swingPhase) * 0.12;
  // The swinging foot only travels while it is off the ground.
  const swing = (p: Vec3): Vec3 => [
    p[0] * (1 - 0.6 * Math.sin(Math.PI * swingPhase)),
    p[1] + lift,
    p[2] - lift * 0.4,
  ];
  const ankleL = leftSupport ? plantedL : swing(plantedL);
  const ankleR = leftSupport ? swing(plantedR) : plantedR;
  const contact: [boolean, boolean] = [leftSupport || lift < 0.005, !leftSupport || lift < 0.005];

  // Hips shift over the support foot.
  const shift = (leftSupport ? 1 : -1) * sway * Math.sin(Math.PI * u) * 0.5;
  const bounce = 0.035 * Math.cos(2 * Math.PI * u);
  const hipMid: Vec3 = [shift, THIGH + SHIN + ANKLE_H - 0.05 + bounce, 0];
  const yaw = yawAmp * Math.sin((2 * Math.PI * t) / (period * 2));
  const yawQ = axisAngle([0, 1, 0], yaw);
  const hipYaw = axisAngle([0, 1, 0], yaw * 0.4);
  const hipL = add(hipMid, rotate(hipYaw, [HIP_W, 0, 0]));
  const hipR = add(hipMid, rotate(hipYaw, [-HIP_W, 0, 0]));
  const forward: Vec3 = [0, 0, -1];
  const kneeL = twoBone(hipL, ankleL, THIGH, SHIN, rotate(hipYaw, forward));
  const kneeR = twoBone(hipR, ankleR, THIGH, SHIN, rotate(hipYaw, forward));

  const lean = axisAngle([1, 0, 0], 0.12 * Math.sin(2 * Math.PI * u));
  const torsoQ = yawQ;
  const up = rotate(lean, rotate(torsoQ, [0, TORSO, 0]));
  const shMid = add(hipMid, up);
  const shL = add(shMid, rotate(torsoQ, [SHOULDER_W, 0, 0]));
  const shR = add(shMid, rotate(torsoQ, [-SHOULDER_W, 0, 0]));

  // Arms: raise/lower in the frontal plane, elbows bend forward.
  const raise = 0.6 + 0.5 * Math.sin((2 * Math.PI * t) / period);
  const arm = (side: 1 | -1, shoulder: Vec3, phase: number): Vec3[] => {
    const abduct = raise + 0.3 * Math.sin(phase);
    const upper = rotate(torsoQ, [side * Math.sin(abduct), -Math.cos(abduct), 0]);
    const bend = elbowAmp * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / period + phase));
    const hinge = normalize(cross(upper, rotate(torsoQ, forward)));
    const fore = rotate(axisAngle(hinge, bend), upper);
    const elbow = add(shoulder, scale(upper, UPPER_ARM));
    const wrist = add(elbow, scale(fore, FOREARM));
    const hand = add(wrist, scale(fore, HAND));
    const across = rotate(torsoQ, forward);
    return [
      elbow,
      wrist,
      add(hand, scale(across, 0.02)),
      add(hand, scale(across, -0.02)),
      add(wrist, scale(across, 0.03)),
    ];
  };
  const [elbowL, wristL, indexL, pinkyL, thumbL] = arm(1, shL, 0);
  const [elbowR, wristR, indexR, pinkyR, thumbR] = arm(-1, shR, Math.PI);

  // Head.
  const headYaw = axisAngle([0, 1, 0], yaw * 1.6);
  const neck = add(shMid, [0, 0.06, 0]);
  const headC = add(neck, [0, 0.14, 0]);
  const face = (v: Vec3): Vec3 => add(headC, rotate(headYaw, v));

  const foot = (ankle: Vec3, yawF: number): Vec3[] => {
    const dir = rotate(axisAngle([0, 1, 0], yawF), [0, 0, -1]);
    return [
      add(ankle, add(scale(dir, -0.05), [0, -0.06, 0])),
      add(ankle, add(scale(dir, 0.16), [0, -0.07, 0])),
    ];
  };
  const [heelL, toeL] = foot(ankleL, yaw * 0.3);
  const [heelR, toeR] = foot(ankleR, yaw * 0.3);

  const j: Vec3[] = new Array(LANDMARK_COUNT);
  j[LM.nose] = face([0, 0.02, -0.1]);
  j[LM.leftEyeInner] = face([0.015, 0.05, -0.09]);
  j[LM.leftEye] = face([0.03, 0.05, -0.09]);
  j[LM.leftEyeOuter] = face([0.045, 0.05, -0.085]);
  j[LM.rightEyeInner] = face([-0.015, 0.05, -0.09]);
  j[LM.rightEye] = face([-0.03, 0.05, -0.09]);
  j[LM.rightEyeOuter] = face([-0.045, 0.05, -0.085]);
  j[LM.leftEar] = face([0.075, 0.03, 0]);
  j[LM.rightEar] = face([-0.075, 0.03, 0]);
  j[LM.mouthLeft] = face([0.025, -0.03, -0.09]);
  j[LM.mouthRight] = face([-0.025, -0.03, -0.09]);
  j[LM.leftShoulder] = shL;
  j[LM.rightShoulder] = shR;
  j[LM.leftElbow] = elbowL;
  j[LM.rightElbow] = elbowR;
  j[LM.leftWrist] = wristL;
  j[LM.rightWrist] = wristR;
  j[LM.leftPinky] = pinkyL;
  j[LM.rightPinky] = pinkyR;
  j[LM.leftIndex] = indexL;
  j[LM.rightIndex] = indexR;
  j[LM.leftThumb] = thumbL;
  j[LM.rightThumb] = thumbR;
  j[LM.leftHip] = hipL;
  j[LM.rightHip] = hipR;
  j[LM.leftKnee] = kneeL;
  j[LM.rightKnee] = kneeR;
  j[LM.leftAnkle] = ankleL;
  j[LM.rightAnkle] = ankleR;
  j[LM.leftHeel] = heelL;
  j[LM.rightHeel] = heelR;
  j[LM.leftFootIndex] = toeL;
  j[LM.rightFootIndex] = toeR;
  return { joints: j, contact };
}

/** Deterministic pseudo-random noise in [-1, 1]. */
function hashNoise(a: number, b: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Ground truth → MediaPipe-format world + image landmarks. */
export function syntheticFrame(t: number, o: SyntheticOptions = {}): SyntheticFrame {
  const { joints, contact } = syntheticPose(t, o);
  const [w, h] = o.imageSize ?? [640, 360];
  const camZ = -(o.cameraDistance ?? 4);
  const camY = 1.0;
  const focal = 0.9 * Math.max(w, h);
  const hipMid: Vec3 = [
    (joints[LM.leftHip][0] + joints[LM.rightHip][0]) / 2,
    (joints[LM.leftHip][1] + joints[LM.rightHip][1]) / 2,
    (joints[LM.leftHip][2] + joints[LM.rightHip][2]) / 2,
  ];
  const world = new Float32Array(LANDMARK_COUNT * 4);
  const image = new Float32Array(LANDMARK_COUNT * 4);
  const noise = o.noise ?? 0;
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    // Mirrored video: the picture is flipped horizontally, so sides and x swap.
    const src = joints[i];
    const p: Vec3 = o.mirror ? [-src[0], src[1], src[2]] : src;
    const n = noise ? [hashNoise(t, i), hashNoise(t + 1, i), hashNoise(t + 2, i)] : [0, 0, 0];
    const rel = sub(p, o.mirror ? [-hipMid[0], hipMid[1], hipMid[2]] : hipMid);
    // MMD (x, y up, z away) → MediaPipe (x, y down, z away).
    world[i * 4] = rel[0] + n[0] * noise;
    world[i * 4 + 1] = -rel[1] + n[1] * noise;
    world[i * 4 + 2] = rel[2] + n[2] * noise;
    world[i * 4 + 3] = 0.99;
    const depth = p[2] - camZ;
    image[i * 4] = 0.5 + (focal * p[0]) / depth / w;
    image[i * 4 + 1] = 0.5 - (focal * (p[1] - camY)) / depth / h;
    image[i * 4 + 2] = rel[2];
    image[i * 4 + 3] = 0.99;
  }
  if (o.mirror) {
    // Labels follow appearance: what looks like the left side is reported as left.
    const swap = (arr: Float32Array): void => {
      const copy = arr.slice();
      for (let i = 0; i < LANDMARK_COUNT; i++) {
        const m = mirrorPartner(i);
        for (let c = 0; c < 4; c++) arr[i * 4 + c] = copy[m * 4 + c];
      }
    };
    swap(world);
    swap(image);
  }
  return { world, image, truth: joints, contact };
}

const PAIRS: Record<number, number> = (() => {
  const out: Record<number, number> = {};
  const pairs = [
    [1, 4],
    [2, 5],
    [3, 6],
    [7, 8],
    [9, 10],
    [11, 12],
    [13, 14],
    [15, 16],
    [17, 18],
    [19, 20],
    [21, 22],
    [23, 24],
    [25, 26],
    [27, 28],
    [29, 30],
    [31, 32],
  ];
  for (const [a, b] of pairs) {
    out[a] = b;
    out[b] = a;
  }
  return out;
})();
const mirrorPartner = (i: number): number => PAIRS[i] ?? i;

/** Draw the stick figure into a 2D canvas context (used to render test videos). */
export function drawStickFigure(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: SyntheticFrame,
  w: number,
  h: number,
): void {
  ctx.fillStyle = '#e8e4da';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#b9b2a2';
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  const pt = (i: number): [number, number] => [frame.image[i * 4] * w, frame.image[i * 4 + 1] * h];
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#2b3a67';
  ctx.lineWidth = Math.max(4, w / 60);
  const seg = (a: number, b: number): void => {
    const [ax, ay] = pt(a);
    const [bx, by] = pt(b);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };
  for (const [a, b] of [
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [11, 23],
    [12, 24],
    [23, 24],
    [23, 25],
    [25, 27],
    [27, 31],
    [24, 26],
    [26, 28],
    [28, 32],
  ] as [number, number][])
    seg(a, b);
  const [nx, ny] = pt(0);
  ctx.fillStyle = '#c0504d';
  ctx.beginPath();
  ctx.arc(nx, ny, Math.max(8, w / 40), 0, Math.PI * 2);
  ctx.fill();
}
