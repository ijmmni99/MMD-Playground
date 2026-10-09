// Two-view fusion: put both pose tracks on one 30 fps timeline, map the side view into the front camera's
// frame, and combine each joint by visibility and view geometry (each camera is trusted least along its own
// viewing direction). Optional DLT triangulation per joint where it reprojects better. Output is an
// ordinary PoseSequence for the unchanged cleaning / retargeting / writer.
import { LANDMARK_COUNT, LIMBS, LM } from '@/engine/video2vmd/landmarks';
import { mpWorldToMmd } from '@/engine/video2vmd/coords';
import type { CropBox, PoseFrame, PoseSequence } from '@/engine/video2vmd/types';
import type { Vec3 } from '@/lib/math3d';
import { camToWorld, focalFromFov, viewDir } from './camera';
import { linearCamera, reprojectionError, triangulate, type LinearCamera } from './calibrate';
import { headFromMatrix } from './face';
import type { Calibration, FaceObs, HandObs, HandPair } from './types';

export const SHARED_FPS = 30;

/** Pose frame at time t: linear between neighbours; undetected when the nearest detection is > maxGap away. */
export function sampleFrame(frames: PoseFrame[], t: number, maxGap = 0.12): PoseFrame {
  const empty: PoseFrame = {
    time: t,
    detected: false,
    image: new Float32Array(0),
    world: new Float32Array(0),
  };
  if (!frames.length || t < frames[0].time - maxGap || t > frames[frames.length - 1].time + maxGap)
    return empty;
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (frames[m].time <= t) lo = m;
    else hi = m;
  }
  const a = frames[lo];
  const b = frames[hi];
  const near = Math.abs(a.time - t) <= Math.abs(b.time - t) ? a : b;
  if (a.detected && b.detected && b.time > a.time && t >= a.time && t <= b.time) {
    const u = (t - a.time) / (b.time - a.time);
    const lerp = (x: ArrayLike<number>, y: ArrayLike<number>): Float32Array =>
      Float32Array.from({ length: x.length }, (_, i) => x[i] + (y[i] - x[i]) * u);
    return { ...near, time: t, detected: true, image: lerp(a.image, b.image), world: lerp(a.world, b.world) };
  }
  const det = [a, b].filter((f) => f.detected).sort((x, y) => Math.abs(x.time - t) - Math.abs(y.time - t))[0];
  if (det && Math.abs(det.time - t) <= maxGap) return { ...det, time: t };
  return { ...empty, face: near.face ?? null, hands: near.hands ?? null };
}

export interface FusionSettings {
  /** Landmark visibility below which a view's joint is ignored. */
  visibility: number;
  /** Use DLT triangulation where it reprojects better. */
  triangulate: boolean;
}

export interface FusionStats {
  /** Fraction of joint samples fused from both views. */
  fusedPct: number;
  /** Frames where at least one body joint came from one view only. */
  singleView: boolean[];
  /** Detection rates of each view over the shared range. */
  detected: [number, number];
  /** Joints (per frame) that used the DLT point. */
  dltPct: number;
}

const VIS_DEFAULT = 0.5;
const BODY = Array.from({ length: LANDMARK_COUNT }, (_, i) => i);

/** Axis reliability of a camera along unit world axis e. */
const reliability = (d: Vec3, axis: 0 | 1 | 2): number => 1 - 0.85 * d[axis] * d[axis];

/** Full-video normalised coordinates of an analysed-area point. */
const toVideo = (crop: CropBox | null, u: number, v: number): [number, number] =>
  crop ? [crop.x + u * crop.w, crop.y + v * crop.h] : [u, v];

/** Fuse two sequences. `offset`: side time = front time + offset. */
export function fuseViews(
  front: PoseSequence,
  side: PoseSequence,
  offset: number,
  cal: Calibration,
  settings: Partial<FusionSettings> = {},
): { sequence: PoseSequence; stats: FusionStats } {
  const vis = settings.visibility ?? VIS_DEFAULT;
  const ff = front.frames;
  const sf = side.frames;
  const start = Math.max(ff[0]?.time ?? 0, (sf[0]?.time ?? 0) - offset);
  const end = Math.min(ff[ff.length - 1]?.time ?? 0, (sf[sf.length - 1]?.time ?? 0) - offset);
  const n = Math.max(0, Math.floor((end - start) * SHARED_FPS + 1e-6) + 1);
  const d0 = viewDir(0);
  const d1 = viewDir(cal.yawDeg);
  const s = cal.scale || 1;

  // Cameras for DLT (world = front camera frame, front camera at the origin).
  const vf: [number, number] = [front.video.width, front.video.height];
  const vs: [number, number] = [side.video.width, side.video.height];
  const focF = focalFromFov(cal.fovDeg, vf[0]);
  const focS = focalFromFov(cal.fovDeg, vs[0]);
  const camF = linearCamera(0, [0, 0, 0], focF, vf);

  const fusedFrames: PoseFrame[] = [];
  const singleView: boolean[] = [];
  let fusedJoints = 0;
  let totalJoints = 0;
  let dltJoints = 0;
  let detF = 0;
  let detS = 0;
  let lastImage: ArrayLike<number> | null = null;

  // Side camera centre: the hip seen by both (weak perspective depth), median over frames.
  const sideCentre = estimateSideCentre(front, side, offset, cal, focF, focS, start, n);
  const camS: LinearCamera | null = sideCentre ? linearCamera(cal.yawDeg, sideCentre, focS, vs) : null;

  for (let k = 0; k < n; k++) {
    const t = start + k / SHARED_FPS;
    const fa = sampleFrame(ff, t);
    const fb = sampleFrame(sf, t + offset);
    if (fa.detected) detF++;
    if (fb.detected) detS++;
    const A = fa.detected
      ? Array.from({ length: LANDMARK_COUNT }, (_, i) =>
          mpWorldToMmd(fa.world[i * 4], fa.world[i * 4 + 1], fa.world[i * 4 + 2]),
        )
      : null;
    const B = fb.detected
      ? Array.from({ length: LANDMARK_COUNT }, (_, i) =>
          camToWorld(
            cal.yawDeg,
            mpWorldToMmd(fb.world[i * 4] * s, fb.world[i * 4 + 1] * s, fb.world[i * 4 + 2] * s),
          ),
        )
      : null;
    const out: Vec3[] = [];
    const outVis: number[] = [];
    let single = false;
    // DLT hip centre for this frame (absolute), when both views see the hips.
    let hipAbs: Vec3 | null = null;
    const obsOf = (j: number): { cam: LinearCamera; u: number; v: number }[] | null => {
      if (!camS || !fa.detected || !fb.detected) return null;
      const [u0, v0] = toVideo(front.crop, fa.image[j * 4], fa.image[j * 4 + 1]);
      const [u1, v1] = toVideo(side.crop, fb.image[j * 4], fb.image[j * 4 + 1]);
      return [
        { cam: camF, u: u0, v: v0 },
        { cam: camS, u: u1, v: v1 },
      ];
    };
    if (settings.triangulate && camS && A && B) {
      const l = obsOf(LM.leftHip);
      const r = obsOf(LM.rightHip);
      const pl = l && triangulate(l);
      const pr = r && triangulate(r);
      if (pl && pr) hipAbs = [(pl[0] + pr[0]) / 2, (pl[1] + pr[1]) / 2, (pl[2] + pr[2]) / 2];
    }
    for (const j of BODY) {
      const va = A ? (fa.world[j * 4 + 3] ?? 0) : 0;
      const vb = B ? (fb.world[j * 4 + 3] ?? 0) : 0;
      const okA = va >= vis;
      const okB = vb >= vis;
      totalJoints++;
      if (okA && okB) {
        fusedJoints++;
        const p: Vec3 = [0, 0, 0];
        for (const ax of [0, 1, 2] as const) {
          const wa = va * reliability(d0, ax);
          const wb = vb * reliability(d1, ax);
          p[ax] = (wa * A![j][ax] + wb * B![j][ax]) / (wa + wb);
        }
        if (hipAbs) {
          const obs = obsOf(j);
          const pd = obs && triangulate(obs);
          if (pd) {
            const fusedAbs: Vec3 = [hipAbs[0] + p[0], hipAbs[1] + p[1], hipAbs[2] + p[2]];
            if (reprojectionError(pd, obs!) < reprojectionError(fusedAbs, obs!)) {
              p[0] = pd[0] - hipAbs[0];
              p[1] = pd[1] - hipAbs[1];
              p[2] = pd[2] - hipAbs[2];
              dltJoints++;
            }
          }
        }
        out.push(p);
        outVis.push(Math.max(va, vb));
      } else if (okA || okB) {
        single = true;
        out.push(okA ? A![j] : B![j]);
        outVis.push(okA ? va : vb);
      } else {
        out.push(A?.[j] ?? B?.[j] ?? [0, 0, 0]);
        outVis.push(0);
      }
    }
    // Hip-centre: re-centre on the fused hips (both inputs are hip-centred; tiny drift otherwise).
    const hip: Vec3 = [
      (out[LM.leftHip][0] + out[LM.rightHip][0]) / 2,
      (out[LM.leftHip][1] + out[LM.rightHip][1]) / 2,
      (out[LM.leftHip][2] + out[LM.rightHip][2]) / 2,
    ];
    const detected = !!(A || B);
    const world = new Float32Array(LANDMARK_COUNT * 4);
    out.forEach((p, j) => world.set([p[0] - hip[0], -(p[1] - hip[1]), p[2] - hip[2], outVis[j]], j * 4));
    // Image track (root motion) from the front view; held through front dropouts.
    if (fa.detected) lastImage = fa.image;
    const image = Float32Array.from(lastImage ?? new Float32Array(LANDMARK_COUNT * 4));
    if (!fa.detected && lastImage) for (let j = 0; j < LANDMARK_COUNT; j++) image[j * 4 + 3] = 1;
    fusedFrames.push({
      time: t,
      detected: detected && !!lastImage,
      image,
      world,
      people: Math.max(fa.people ?? 0, fb.people ?? 0) || 1,
      face: fuseFace(fa.face ?? null, fb.face ?? null, cal.yawDeg),
      hands: fuseHands(fa.hands ?? null, fb.hands ?? null, cal.yawDeg, front, side),
    });
    singleView.push(single);
  }
  enforceBoneLengths(fusedFrames);
  return {
    sequence: {
      version: 1,
      estimator: `${front.estimator} + ${side.estimator} (two-view)`,
      video: front.video,
      trim: [start, start + (n - 1) / SHARED_FPS],
      crop: front.crop,
      analysedSize: front.analysedSize,
      sampleFps: SHARED_FPS,
      frames: fusedFrames,
    },
    stats: {
      fusedPct: totalJoints ? (fusedJoints / totalJoints) * 100 : 0,
      singleView,
      detected: [n ? (detF / n) * 100 : 0, n ? (detS / n) * 100 : 0],
      dltPct: fusedJoints ? (dltJoints / fusedJoints) * 100 : 0,
    },
  };
}

/** Side camera centre in the front camera frame from both views' weak-perspective hip positions. */
function estimateSideCentre(
  front: PoseSequence,
  side: PoseSequence,
  offset: number,
  cal: Calibration,
  focF: number,
  focS: number,
  start: number,
  n: number,
): Vec3 | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const hipCam = (f: PoseFrame, seq: PoseSequence, focal: number, dist: number): Vec3 => {
    const [u, v] = toVideo(
      seq.crop,
      (f.image[LM.leftHip * 4] + f.image[LM.rightHip * 4]) / 2,
      (f.image[LM.leftHip * 4 + 1] + f.image[LM.rightHip * 4 + 1]) / 2,
    );
    const x = ((u - 0.5) * seq.video.width) / focal;
    const y = (-(v - 0.5) * seq.video.height) / focal;
    return [x * dist, y * dist, dist];
  };
  for (let k = 0; k < n; k += 2) {
    const t = start + k / SHARED_FPS;
    const fa = sampleFrame(front.frames, t);
    const fb = sampleFrame(side.frames, t + offset);
    if (!fa.detected || !fb.detected) continue;
    const hw = hipCam(fa, front, focF, cal.distance[0]);
    const hs = camToWorld(cal.yawDeg, hipCam(fb, side, focS, cal.distance[1]));
    xs.push(hw[0] - hs[0]);
    ys.push(hw[1] - hs[1]);
    zs.push(hw[2] - hs[2]);
  }
  if (xs.length < 3) return null;
  const med = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1];
  return [med(xs), med(ys), med(zs)];
}

/** Median limb lengths, then each child re-placed along its direction from the parent. */
export function enforceBoneLengths(frames: PoseFrame[]): void {
  const det = frames.filter((f) => f.detected);
  if (!det.length) return;
  const len = LIMBS.map(([a, b]) => {
    const v = det
      .filter((f) => (f.world[a * 4 + 3] ?? 0) > 0 && (f.world[b * 4 + 3] ?? 0) > 0)
      .map((f) =>
        Math.hypot(
          f.world[a * 4] - f.world[b * 4],
          f.world[a * 4 + 1] - f.world[b * 4 + 1],
          f.world[a * 4 + 2] - f.world[b * 4 + 2],
        ),
      )
      .sort((x, y) => x - y);
    return v[v.length >> 1] ?? 0;
  });
  for (const f of det) {
    const w = f.world as Float32Array;
    LIMBS.forEach(([a, b], k) => {
      if (!len[k]) return;
      const dx = w[b * 4] - w[a * 4];
      const dy = w[b * 4 + 1] - w[a * 4 + 1];
      const dz = w[b * 4 + 2] - w[a * 4 + 2];
      const l = Math.hypot(dx, dy, dz);
      if (l < 1e-6) return;
      const r = len[k] / l;
      w[b * 4] = w[a * 4] + dx * r;
      w[b * 4 + 1] = w[a * 4 + 1] + dy * r;
      w[b * 4 + 2] = w[a * 4 + 2] + dz * r;
    });
  }
}

/** Rebuild a camera-space face matrix (front camera) from a world head rotation. */
function matrixFromHead(m: number[], yawDeg: number): number[] {
  const q = headFromMatrix(m, yawDeg);
  // Inverse of headFromMatrix with camYaw 0: R_cam = S·R_mmd·S, S = diag(1, 1, −1).
  const rot = (v: Vec3): Vec3 => {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [
      v[0] + w * tx + (y * tz - z * ty),
      v[1] + w * ty + (z * tx - x * tz),
      v[2] + w * tz + (x * ty - y * tx),
    ];
  };
  const col = (e: Vec3): Vec3 => {
    const r = rot([e[0], e[1], -e[2]]);
    return [r[0], r[1], -r[2]];
  };
  const c0 = col([1, 0, 0]);
  const c1 = col([0, 1, 0]);
  const c2 = col([0, 0, 1]);
  return [...c0, 0, ...c1, 0, ...c2, 0, m[12] ?? 0, m[13] ?? 0, m[14] ?? 0, 1];
}

/** How frontal a face is to its own camera (1 = looking straight at it). */
const frontality = (m: number[]): number => {
  const z = Math.hypot(m[8], m[9], m[10]) || 1;
  return Math.max(0, m[10] / z);
};
const cropArea = (c: { w: number; h: number }): number => c.w * c.h;

/** Pick / blend the face from the better view (larger and more frontal), expressed in the front frame. */
export function fuseFace(a: FaceObs | null, b: FaceObs | null, yawDeg: number): FaceObs | null {
  if (!a && !b) return null;
  const score = (f: FaceObs): number => f.score * (0.2 + frontality(f.matrix)) * Math.sqrt(cropArea(f.crop));
  const sa = a ? score(a) : 0;
  const sb = b ? score(b) : 0;
  const best = sa >= sb ? a! : b!;
  const matrix = best === a ? best.matrix : matrixFromHead(best.matrix, yawDeg);
  const blend =
    a && b ? a.blend.map((v, i) => (v * sa + b.blend[i] * sb) / Math.max(1e-9, sa + sb)) : best.blend;
  // Gaze points stay from the chosen view; a side-view face reads its own eyes.
  return { ...best, matrix, blend, score: Math.max(a?.score ?? 0, b?.score ?? 0) };
}

/** Hands: per side, the observation with the larger, more confident palm; side-view points rotated in. */
function fuseHands(
  a: HandPair | null,
  b: HandPair | null,
  yawDeg: number,
  front: PoseSequence,
  side: PoseSequence,
): HandPair | null {
  if (!a && !b) return null;
  const area = (h: HandObs, size: [number, number]): number => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < h.image.length; i += 3) {
      xs.push(h.image[i] * size[0]);
      ys.push(h.image[i + 1] * size[1]);
    }
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  };
  const out: HandPair = [null, null];
  for (const k of [0, 1] as const) {
    const ha = a?.[k] ?? null;
    const hb = b?.[k] ?? null;
    const sa = ha ? ha.score * Math.sqrt(area(ha, front.analysedSize)) : 0;
    const sb = hb ? hb.score * Math.sqrt(area(hb, side.analysedSize)) : 0;
    if (!ha && !hb) continue;
    if (sa >= sb) out[k] = ha;
    else {
      // Rotate the side view's hand-world points into the front frame (MediaPipe axes: y down).
      const w: number[] = [];
      for (let i = 0; i < hb!.world.length; i += 3) {
        const p = camToWorld(yawDeg, [hb!.world[i], -hb!.world[i + 1], hb!.world[i + 2]]);
        w.push(p[0], -p[1], p[2]);
      }
      out[k] = { ...hb!, world: w };
    }
  }
  return out;
}
