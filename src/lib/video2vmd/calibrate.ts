// Camera relationship between the front and side views: relative yaw by a robust yaw-only Procrustes
// (Kabsch) fit of the two views' world landmarks, shared scale, floor, distances, and linear (DLT)
// triangulation with reprojection error. Coordinates: MMD axes (x = dancer's left, y up, z away from the
// front camera), metres, hip-centred unless stated.
import { LM } from '@/engine/video2vmd/landmarks';
import { mpWorldToMmd } from '@/engine/video2vmd/coords';
import type { PoseFrame } from '@/engine/video2vmd/types';
import type { Vec3 } from '@/lib/math3d';
import { camToWorld, focalFromFov } from './camera';
import type { Calibration } from './types';

const RAD = Math.PI / 180;

/** Body joints used for calibration (no face, no hand tips). */
export const CALIB_JOINTS: number[] = [
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
  LM.leftHeel,
  LM.rightHeel,
  LM.leftFootIndex,
  LM.rightFootIndex,
];

export interface PointPair {
  a: Vec3;
  b: Vec3;
  w: number;
  /** Which frame (for windowed checks). */
  frame: number;
}

/** World landmarks of one frame in MMD axes. */
export const frameMmd = (f: PoseFrame): Vec3[] =>
  Array.from({ length: 33 }, (_, i) => mpWorldToMmd(f.world[i * 4], f.world[i * 4 + 1], f.world[i * 4 + 2]));

/**
 * Yaw θ (degrees) best mapping side points onto front points (a ≈ R_y(θ)·b) in the x–z plane, by
 * iteratively reweighted (Huber) weighted Procrustes. A prior pulls toward θ0 when the fit is weak.
 */
export function fitYaw(
  pairs: PointPair[],
  priorDeg: number,
  opts: { iterations?: number; priorWeight?: number } = {},
): { yawDeg: number; inliers: number; certainty: number; residual: number } {
  if (!pairs.length) return { yawDeg: priorDeg, inliers: 0, certainty: 0, residual: Infinity };
  const w = pairs.map((p) => p.w);
  let theta = priorDeg * RAD;
  let delta = Infinity;
  let certainty = 0;
  const iters = opts.iterations ?? 6;
  const residuals = (th: number): number[] => {
    const c = Math.cos(th);
    const s = Math.sin(th);
    return pairs.map(({ a, b }) => Math.hypot(a[0] - (c * b[0] - s * b[2]), a[2] - (s * b[0] + c * b[2])));
  };
  for (let it = 0; it < iters; it++) {
    let s1 = 0;
    let s2 = 0;
    let norm = 0;
    pairs.forEach(({ a, b }, i) => {
      s1 += w[i] * (a[0] * b[0] + a[2] * b[2]);
      s2 += w[i] * (a[2] * b[0] - a[0] * b[2]);
      norm += w[i] * Math.hypot(a[0], a[2]) * Math.hypot(b[0], b[2]);
    });
    certainty = norm > 0 ? Math.hypot(s1, s2) / norm : 0;
    // Prior: add a pseudo-observation along θ0, weighted so it matters only when the data is weak.
    const pw = (opts.priorWeight ?? 0.05) * norm;
    s1 += pw * Math.cos(priorDeg * RAD);
    s2 += pw * Math.sin(priorDeg * RAD);
    theta = Math.atan2(s2, s1);
    const r = residuals(theta);
    const sorted = [...r].sort((x, y) => x - y);
    delta = Math.max(0.02, 1.5 * (sorted[sorted.length >> 1] ?? 0.05));
    r.forEach((ri, i) => (w[i] = pairs[i].w * Math.min(1, delta / Math.max(1e-9, ri))));
  }
  const r = residuals(theta);
  const inliers = r.filter((x) => x < Math.max(0.12, 2 * delta)).length / r.length;
  let deg = theta / RAD;
  if (deg < -180) deg += 360;
  if (deg > 180) deg -= 360;
  const sorted = [...r].sort((x, y) => x - y);
  return { yawDeg: deg, inliers, certainty, residual: sorted[sorted.length >> 1] ?? 0 };
}

/** Camera distance (metres) by weak perspective: focal × true length / projected length. */
export function cameraDistance(frames: PoseFrame[], size: [number, number], focal: number): number {
  const est: number[] = [];
  for (const f of frames) {
    if (!f.detected) continue;
    const P = frameMmd(f);
    for (const [a, b] of [
      [LM.leftShoulder, LM.leftHip],
      [LM.rightShoulder, LM.rightHip],
      [LM.leftHip, LM.leftKnee],
      [LM.rightHip, LM.rightKnee],
    ] as [number, number][]) {
      const real = Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1], P[a][2] - P[b][2]);
      const px = Math.hypot(
        (f.image[a * 4] - f.image[b * 4]) * size[0],
        (f.image[a * 4 + 1] - f.image[b * 4 + 1]) * size[1],
      );
      if (px > 4 && real > 0.1) est.push((focal * real) / px);
    }
  }
  est.sort((x, y) => x - y);
  // Foreshortened limbs overestimate distance; use a low percentile.
  return est[Math.floor(est.length * 0.3)] ?? 4;
}

export interface CalibrationInput {
  /** Time-aligned frame pairs (front, side) on the shared timeline. */
  front: PoseFrame[];
  side: PoseFrame[];
  priorDeg: number;
  fovDeg: number;
  frontSize: [number, number];
  sideSize: [number, number];
  /** Frames per second of the shared timeline (for the moving-camera check). */
  fps: number;
  visibility?: number;
}

/** Full calibration with plain-language warnings. */
export function calibrate(input: CalibrationInput): Calibration {
  const vis = input.visibility ?? 0.5;
  const n = Math.min(input.front.length, input.side.length);
  const both: number[] = [];
  const A: Vec3[][] = [];
  const B: Vec3[][] = [];
  for (let i = 0; i < n; i++) {
    if (input.front[i].detected && input.side[i].detected) both.push(i);
    A.push(input.front[i].detected ? frameMmd(input.front[i]) : []);
    B.push(input.side[i].detected ? frameMmd(input.side[i]) : []);
  }
  const coverage = n ? both.length / n : 0;
  // Shared scale from the vertical extent (y is reliable in both views; limb lengths are not, because each
  // view under-estimates depth along its own axis).
  let ya = 0;
  let yb = 0;
  for (const i of both) {
    for (const j of CALIB_JOINTS) {
      ya += Math.abs(A[i][j][1]);
      yb += Math.abs(B[i][j][1]);
    }
  }
  const scale = ya > 0 && yb > 0 ? ya / yb : 1;
  const pairs: PointPair[] = [];
  for (const i of both) {
    for (const j of CALIB_JOINTS) {
      const wa = Math.min(input.front[i].world[j * 4 + 3] ?? 0, 1);
      const wb = Math.min(input.side[i].world[j * 4 + 3] ?? 0, 1);
      if (wa < vis || wb < vis) continue;
      const b = B[i][j];
      pairs.push({ a: A[i][j], b: [b[0] * scale, b[1] * scale, b[2] * scale], w: wa * wb, frame: i });
    }
  }
  const fit = fitYaw(pairs, input.priorDeg);
  const yaw = fit.yawDeg;

  // Mean residual translation (≈ 0 for hip-centred data).
  const tr: Vec3 = [0, 0, 0];
  if (pairs.length) {
    for (const p of pairs) {
      const rb = camToWorld(yaw, p.b);
      tr[0] += (p.a[0] - rb[0]) / pairs.length;
      tr[1] += (p.a[1] - rb[1]) / pairs.length;
      tr[2] += (p.a[2] - rb[2]) / pairs.length;
    }
  }

  // Cameras moved: yaw per 5 s window.
  const win = Math.max(30, Math.round(input.fps * 5));
  const yaws: number[] = [];
  for (let s = 0; s < n; s += win) {
    const sub = pairs.filter((p) => p.frame >= s && p.frame < s + win);
    if (sub.length > 40) yaws.push(fitYaw(sub, yaw, { iterations: 3 }).yawDeg);
  }
  const spread = yaws.length > 1 ? Math.max(...yaws) - Math.min(...yaws) : 0;

  const focalF = focalFromFov(input.fovDeg, input.frontSize[0]);
  const focalS = focalFromFov(input.fovDeg, input.sideSize[0]);
  const distance: [number, number] = [
    cameraDistance(input.front, input.frontSize, focalF),
    cameraDistance(input.side, input.sideSize, focalS),
  ];

  const warnings: string[] = [];
  if (coverage < 0.6)
    warnings.push(
      `The dancer is visible in both videos for only ${Math.round(coverage * 100)}% of the time; keep the whole body in both shots.`,
    );
  if (spread > 15)
    warnings.push(
      'The cameras seem to move during the clip; use tripods and don’t touch them while filming.',
    );
  const absYaw = Math.abs(yaw);
  if (absYaw < 25 || absYaw > 155)
    warnings.push('The two views are too similar; place the side camera about 90° from the front one.');
  if (Math.abs(yaw - input.priorDeg) > 35 && fit.certainty > 0.3)
    warnings.push(
      `The measured camera angle (${Math.round(yaw)}°) differs from the angle you entered (${Math.round(input.priorDeg)}°).`,
    );
  const confidence = Math.max(
    0,
    Math.min(
      1,
      fit.inliers * Math.min(1, fit.certainty * 1.4) * Math.min(1, coverage / 0.8) * (spread > 15 ? 0.5 : 1),
    ),
  );
  if (confidence < 0.4 && !warnings.length)
    warnings.push('Calibration is uncertain; check the angle and the sync offset.');

  return {
    yawDeg: yaw,
    translation: tr,
    scale,
    floorY: 0,
    fovDeg: input.fovDeg,
    distance,
    confidence,
    inliers: fit.inliers,
    warnings,
  };
}

// ---------------------------------------------------------------------------------- triangulation

/** A calibrated camera: world → camera frame p_c = M (p − C); normalised image x = X / Z, y = Y / Z. */
export interface LinearCamera {
  /** Rows of the 3×3 rotation (world → camera). */
  M: [Vec3, Vec3, Vec3];
  C: Vec3;
  focal: number;
  size: [number, number];
}

export function linearCamera(yawDeg: number, C: Vec3, focal: number, size: [number, number]): LinearCamera {
  // world → camera = R_y(θ)ᵀ; its rows are the camera axes in world coordinates.
  return {
    M: [camToWorld(yawDeg, [1, 0, 0]), camToWorld(yawDeg, [0, 1, 0]), camToWorld(yawDeg, [0, 0, 1])],
    C,
    focal,
    size,
  };
}

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Normalised image coordinates (0..1, y down) → camera ray coordinates (x / z, y / z; y up). */
const toRay = (cam: LinearCamera, u: number, v: number): [number, number] => [
  ((u - 0.5) * cam.size[0]) / cam.focal,
  (-(v - 0.5) * cam.size[1]) / cam.focal,
];

export function projectLinear(cam: LinearCamera, p: Vec3): [number, number] {
  const d: Vec3 = [p[0] - cam.C[0], p[1] - cam.C[1], p[2] - cam.C[2]];
  const X = dot3(cam.M[0], d);
  const Y = dot3(cam.M[1], d);
  const Z = Math.max(1e-6, dot3(cam.M[2], d));
  return [0.5 + (cam.focal * X) / Z / cam.size[0], 0.5 - (cam.focal * Y) / Z / cam.size[1]];
}

/** Linear (DLT) triangulation of one point from two or more views; least squares on the 2n equations. */
export function triangulate(obs: { cam: LinearCamera; u: number; v: number }[]): Vec3 | null {
  // Each view: (M0 − x M2)·p = (M0 − x M2)·C and (M1 − y M2)·p = (M1 − y M2)·C.
  const AtA = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const Atb = [0, 0, 0];
  for (const { cam, u, v } of obs) {
    const [x, y] = toRay(cam, u, v);
    for (const [r, k] of [
      [cam.M[0], x],
      [cam.M[1], y],
    ] as [Vec3, number][]) {
      const row: Vec3 = [r[0] - k * cam.M[2][0], r[1] - k * cam.M[2][1], r[2] - k * cam.M[2][2]];
      const rhs = dot3(row, cam.C);
      for (let i = 0; i < 3; i++) {
        Atb[i] += row[i] * rhs;
        for (let j = 0; j < 3; j++) AtA[i][j] += row[i] * row[j];
      }
    }
  }
  return solve3(AtA, Atb);
}

function solve3(m: number[][], b: number[]): Vec3 | null {
  const det = (a: number[][]): number =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-12) return null;
  const col = (k: number): number[][] => m.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

/** Reprojection error (pixels, summed over views) of a world point. */
export function reprojectionError(p: Vec3, obs: { cam: LinearCamera; u: number; v: number }[]): number {
  return obs.reduce((s, { cam, u, v }) => {
    const [pu, pv] = projectLinear(cam, p);
    return s + Math.hypot((pu - u) * cam.size[0], (pv - v) * cam.size[1]);
  }, 0);
}
