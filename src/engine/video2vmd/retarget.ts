import type { CleanTrack } from './clean';
import { contactRuns, detectContacts, footSkate, pinFeet } from './contacts';
import { LM } from './landmarks';
import {
  QI,
  add,
  axisAngle,
  clampAngle,
  cross,
  damp,
  dist,
  dot,
  frameRotation,
  length,
  lerp3,
  mid,
  normalize,
  qconj,
  qdot,
  qmul,
  qneg,
  qnormalize,
  rotate,
  scale,
  slerp,
  sub,
  type Quat,
  type Vec3,
} from './math';
import { oneEuroSeries } from './oneEuro';
import { BONE, SIDES, SkeletonIndex, type Side, type Skeleton } from './skeleton';
import type { ConversionSettings } from './types';
import type { BoneKey, PropertyKey } from './vmdWriter';

const DEG = Math.PI / 180;
const UP: Vec3 = [0, 1, 0];
const FORWARD: Vec3 = [0, 0, -1];
const BACK: Vec3 = [0, 0, 1];

export interface RetargetResult {
  modelName: string;
  frameCount: number;
  /** One key per frame per driven bone (before reduction). */
  keys: BoneKey[];
  properties: PropertyKey[];
  /** Driven bone names. */
  bones: string[];
  /** Foot contact flags per frame: [left, right]. */
  contacts: [boolean, boolean][];
  footSkateBefore: number;
  footSkateAfter: number;
  /** MMD units per metre applied to root motion. */
  unitsPerMetre: number;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const ls = (
  side: Side,
): {
  shoulder: number;
  elbow: number;
  wrist: number;
  index: number;
  pinky: number;
  hip: number;
  knee: number;
  ankle: number;
  toe: number;
} =>
  side === '左'
    ? {
        shoulder: LM.leftShoulder,
        elbow: LM.leftElbow,
        wrist: LM.leftWrist,
        index: LM.leftIndex,
        pinky: LM.leftPinky,
        hip: LM.leftHip,
        knee: LM.leftKnee,
        ankle: LM.leftAnkle,
        toe: LM.leftFootIndex,
      }
    : {
        shoulder: LM.rightShoulder,
        elbow: LM.rightElbow,
        wrist: LM.rightWrist,
        index: LM.rightIndex,
        pinky: LM.rightPinky,
        hip: LM.rightHip,
        knee: LM.rightKnee,
        ankle: LM.rightAnkle,
        toe: LM.rightFootIndex,
      };

/** Signed hinge angle of `q` about `axis`, clamped, returned as a pure hinge rotation. */
function hinge(q: Quat, axis: Vec3, min: number, max: number): Quat {
  const qq = q[3] < 0 ? qneg(q) : q;
  const s = qq[0] * axis[0] + qq[1] * axis[1] + qq[2] * axis[2];
  let angle = 2 * Math.atan2(s, qq[3]);
  if (angle > Math.PI) angle -= 2 * Math.PI;
  return axisAngle(axis, Math.min(max, Math.max(min, angle)));
}

/** Weighted blend of two unit vectors (falls back to `a`). */
const blendDir = (a: Vec3, b: Vec3, wb: number): Vec3 => normalize(lerp3(a, b, wb), a);

interface FrameSolve {
  local: Quat[];
  world: Quat[];
}

type Driver = (worldParent: Quat) => { world?: Quat; local?: Quat };

/**
 * Retarget a clean landmark track onto an MMD skeleton: FK rotations for the body, センター root motion
 * with ground contact, and (optionally) foot IK targets pinned during contacts.
 */
export function retarget(
  track: CleanTrack,
  skeleton: Skeleton,
  settings: ConversionSettings,
): RetargetResult {
  const sk = new SkeletonIndex(skeleton);
  const bones = skeleton.bones;
  const n = track.frameCount;
  const restPos = (name: string): Vec3 | null => sk.pos(name);
  const restVec = (from: string, to: string, fallback: Vec3): Vec3 => {
    const a = restPos(from);
    const b = restPos(to);
    return a && b && dist(a, b) > 1e-6 ? normalize(sub(b, a)) : fallback;
  };

  // ---- rest-frame reference vectors (from the model) -------------------------------------------------
  const restHipLat = restVec(BONE.leg('右'), BONE.leg('左'), [1, 0, 0]);
  const restShLat = restVec(BONE.arm('右'), BONE.arm('左'), [1, 0, 0]);
  const restSpine = restVec(BONE.upper, BONE.neck, UP);
  const rest = Object.fromEntries(
    SIDES.map((s) => {
      const dirX: Vec3 = s === '左' ? [1, -0.8, 0] : [-1, -0.8, 0];
      const upper = restVec(BONE.arm(s), BONE.elbow(s), normalize(dirX));
      const fore = restVec(BONE.elbow(s), BONE.wrist(s), upper);
      const handP = sk.has(BONE.middle1(s)) ? restVec(BONE.wrist(s), BONE.middle1(s), fore) : fore;
      const handS =
        sk.has(BONE.index1(s)) && sk.has(BONE.pinky1(s))
          ? restVec(BONE.pinky1(s), BONE.index1(s), FORWARD)
          : FORWARD;
      const thigh = restVec(BONE.leg(s), BONE.knee(s), [0, -1, 0]);
      const shin = restVec(BONE.knee(s), BONE.ankle(s), thigh);
      const toeName = sk.has(BONE.toe(s)) ? BONE.toe(s) : BONE.toeIk(s);
      const foot = restVec(BONE.ankle(s), toeName, [0, -0.5, -1]);
      return [
        s,
        {
          upper,
          fore,
          armHinge: normalize(cross(upper, FORWARD)),
          handP,
          handS,
          thigh,
          shin,
          kneeHinge: normalize(cross(thigh, BACK), [-1, 0, 0]),
          foot,
          toeName,
        },
      ];
    }),
  ) as Record<
    Side,
    {
      upper: Vec3;
      fore: Vec3;
      armHinge: Vec3;
      handP: Vec3;
      handS: Vec3;
      thigh: Vec3;
      shin: Vec3;
      kneeHinge: Vec3;
      foot: Vec3;
      toeName: string;
    }
  >;

  const prevArmHinge: Record<Side, Vec3 | null> = { 左: null, 右: null };

  // Foot pitch calibration: a person's ankle→toe direction is pitched differently from an MMD rig's
  // 足首→つま先, so map the person's flat-foot pitch (frames where the foot is lowest) onto the rig's.
  const pitchOf = (d: Vec3): number => Math.atan2(-d[1], Math.hypot(d[0], d[2]));
  const withPitch = (d: Vec3, pitch: number): Vec3 => {
    const h = normalize([d[0], 0, d[2]], FORWARD);
    return [h[0] * Math.cos(pitch), -Math.sin(pitch), h[2] * Math.cos(pitch)];
  };
  const pitchOffset = Object.fromEntries(
    SIDES.map((s) => {
      const L = ls(s);
      const order = track.world
        .map((P, i): [number, number] => [
          P[L.ankle][1] - Math.min(P[LM.leftAnkle][1], P[LM.rightAnkle][1]),
          i,
        ])
        .sort((a, b) => a[0] - b[0])
        .slice(0, Math.max(1, Math.floor(track.frameCount * 0.4)));
      const pitches = order
        .map(([, i]) => pitchOf(sub(track.world[i][L.toe], track.world[i][L.ankle])))
        .sort((a, b) => a - b);
      const neutral = pitches[pitches.length >> 1] ?? 0;
      return [s, pitchOf(rest[s].foot) - neutral];
    }),
  ) as Record<Side, number>;

  const solveFrame = (P: Vec3[]): FrameSolve => {
    const hipMid = mid(P[LM.leftHip], P[LM.rightHip]);
    const shMid = mid(P[LM.leftShoulder], P[LM.rightShoulder]);
    const spineUp = normalize(sub(shMid, hipMid), UP);
    const hipLat = normalize(sub(P[LM.leftHip], P[LM.rightHip]), [1, 0, 0]);
    const shLat = normalize(sub(P[LM.leftShoulder], P[LM.rightShoulder]), [1, 0, 0]);
    const upperFull = frameRotation(restShLat, restSpine, shLat, spineUp);
    const earMid = mid(P[LM.leftEar], P[LM.rightEar]);
    const headWorld = frameRotation(
      [1, 0, 0],
      FORWARD,
      sub(P[LM.leftEar], P[LM.rightEar]),
      sub(P[LM.nose], earMid),
    );
    const hasUpper2 = sk.has(BONE.upper2);

    const drivers = new Map<string, Driver>();
    const split =
      (target: Quat, t: number): Driver =>
      (wp) => ({
        world: qmul(wp, slerp(QI, qmul(qconj(wp), target), t)),
      });
    drivers.set(BONE.upper, hasUpper2 ? split(upperFull, 0.5) : () => ({ world: upperFull }));
    if (hasUpper2) drivers.set(BONE.upper2, () => ({ world: upperFull }));
    drivers.set(BONE.neck, (wp) => {
      const r = split(headWorld, 0.4)(wp);
      return { local: clampAngle(qmul(qconj(wp), r.world!), 45 * DEG) };
    });
    drivers.set(BONE.head, (wp) => ({ local: clampAngle(qmul(qconj(wp), headWorld), 60 * DEG) }));

    for (const s of SIDES) {
      const L = ls(s);
      const R = rest[s];
      // Arms: twist from the elbow hinge plane; nearly straight arms keep the previous plane.
      const upper = sub(P[L.elbow], P[L.shoulder]);
      const fore = sub(P[L.wrist], P[L.elbow]);
      const raw = cross(upper, fore);
      const bend = length(raw) / Math.max(1e-6, length(upper) * length(fore));
      const prev = prevArmHinge[s] ?? rotate(upperFull, R.armHinge);
      let hingeN = normalize(raw, prev);
      if (dot(hingeN, prev) < 0 && bend < 0.35) hingeN = scale(hingeN, -1);
      hingeN = blendDir(prev, hingeN, smoothstep(0.08, 0.35, bend));
      prevArmHinge[s] = hingeN;
      const armWorld = frameRotation(R.upper, R.armHinge, upper, hingeN);
      drivers.set(BONE.arm(s), () => ({ world: armWorld }));
      const elbowWorld = frameRotation(R.fore, R.armHinge, fore, hingeN);
      drivers.set(BONE.elbow(s), (wp) => ({
        local: hinge(qmul(qconj(wp), elbowWorld), R.armHinge, -5 * DEG, 165 * DEG),
      }));
      const handDir = sub(mid(P[L.index], P[L.pinky]), P[L.wrist]);
      const handSide = sub(P[L.index], P[L.pinky]);
      const handWorld = frameRotation(R.handP, R.handS, handDir, handSide);
      drivers.set(BONE.wrist(s), (wp) => ({
        local: clampAngle(damp(qmul(qconj(wp), handWorld), 0.6), 70 * DEG),
      }));

      if (settings.lowerBody) {
        const thigh = sub(P[L.knee], P[L.hip]);
        const shin = sub(P[L.ankle], P[L.knee]);
        const rawK = cross(thigh, shin);
        const bendK = length(rawK) / Math.max(1e-6, length(thigh) * length(shin));
        const fallback = scale(hipLat, -1);
        const kneeN = blendDir(fallback, normalize(rawK, fallback), smoothstep(0.08, 0.3, bendK));
        const legWorld = frameRotation(R.thigh, R.kneeHinge, thigh, kneeN);
        drivers.set(BONE.leg(s), () => ({ world: legWorld }));
        const kneeWorld = frameRotation(R.shin, R.kneeHinge, shin, kneeN);
        drivers.set(BONE.knee(s), (wp) => ({
          local: hinge(qmul(qconj(wp), kneeWorld), R.kneeHinge, -3 * DEG, 160 * DEG),
        }));
        const footDir = sub(P[L.toe], P[L.ankle]);
        const footTarget = withPitch(footDir, pitchOf(footDir) + pitchOffset[s]);
        const footWorld = frameRotation(R.foot, R.kneeHinge, footTarget, kneeN);
        drivers.set(BONE.ankle(s), (wp) => ({ local: clampAngle(qmul(qconj(wp), footWorld), 60 * DEG) }));
      }
    }
    if (settings.lowerBody) {
      const pelvisUp = blendDir(UP, spineUp, 0.35);
      const lowerWorld = frameRotation(restHipLat, UP, hipLat, pelvisUp);
      drivers.set(BONE.lower, () => ({ world: lowerWorld }));
    }

    const local: Quat[] = bones.map(() => [...QI] as Quat);
    const world: Quat[] = bones.map(() => [...QI] as Quat);
    for (const i of sk.order) {
      const p = bones[i].parent;
      const wp = p >= 0 ? world[p] : QI;
      const d = drivers.get(bones[i].name);
      if (d) {
        const r = d(wp);
        local[i] = qnormalize(r.local ?? qmul(qconj(wp), r.world!));
      }
      world[i] = qnormalize(qmul(wp, local[i]));
    }
    return { local, world };
  };

  // ---- per-frame FK --------------------------------------------------------------------------------
  const solves: FrameSolve[] = track.world.map((P) => solveFrame(P));

  // Rotation continuity (no quaternion sign flips) + light zero-lag slerp smoothing.
  const driven = new Set<number>();
  solves.forEach((s) =>
    s.local.forEach((q, i) => {
      if (Math.abs(q[3]) < 0.999999) driven.add(i);
    }),
  );
  for (const i of driven) {
    for (let f = 1; f < n; f++) {
      if (qdot(solves[f].local[i], solves[f - 1].local[i]) < 0) solves[f].local[i] = qneg(solves[f].local[i]);
    }
    const fwd: Quat[] = [];
    for (let f = 0; f < n; f++)
      fwd.push(f ? slerp(fwd[f - 1], solves[f].local[i], 0.75) : solves[f].local[i]);
    const bwd: Quat[] = new Array(n);
    for (let f = n - 1; f >= 0; f--)
      bwd[f] = f < n - 1 ? slerp(bwd[f + 1], solves[f].local[i], 0.75) : solves[f].local[i];
    for (let f = 0; f < n; f++) solves[f].local[i] = slerp(fwd[f], bwd[f], 0.5);
  }
  // Recompute world rotations after smoothing.
  for (const s of solves) {
    for (const i of sk.order) {
      const p = bones[i].parent;
      s.world[i] = qnormalize(qmul(p >= 0 ? s.world[p] : QI, s.local[i]));
    }
  }

  // ---- scale: model leg length / measured leg length ------------------------------------------------
  const legModel =
    restPos(BONE.leg('左')) && restPos(BONE.knee('左')) && restPos(BONE.ankle('左'))
      ? dist(restPos(BONE.leg('左'))!, restPos(BONE.knee('左'))!) +
        dist(restPos(BONE.knee('左'))!, restPos(BONE.ankle('左'))!)
      : 9.3;
  const legMeasured =
    (track.limbLengths[`${LM.leftHip}-${LM.leftKnee}`] ?? 0.43) +
    (track.limbLengths[`${LM.leftKnee}-${LM.leftAnkle}`] ?? 0.42);
  const unitsPerMetre = (legMeasured > 0.2 ? legModel / legMeasured : 12.5) * settings.scale;

  // ---- root track from the image (weak perspective) -------------------------------------------------
  const centerIdx = sk.index(BONE.center);
  const root: Vec3[] = track.world.map(() => [0, 0, 0]);
  if (settings.lowerBody && centerIdx >= 0 && (settings.rootStrength > 0 || settings.rootDepthStrength > 0)) {
    const [w, h] = track.imageSize;
    const focal = 0.9 * Math.max(w, h);
    const segs: [number, number][] = [
      [LM.leftHip, LM.leftKnee],
      [LM.rightHip, LM.rightKnee],
      [LM.leftKnee, LM.leftAnkle],
      [LM.rightKnee, LM.rightAnkle],
      [LM.leftShoulder, LM.leftHip],
      [LM.rightShoulder, LM.rightHip],
      [LM.leftShoulder, LM.leftElbow],
      [LM.rightShoulder, LM.rightElbow],
    ];
    // Pixels per metre: projected / true length is ≤ the real scale, so a high ratio across segments
    // (second largest, for robustness) approximates it even when some limbs point at the camera.
    const ppm = track.world.map((P, f) => {
      const ratios = segs
        .map(([a, b]) => {
          const img = Math.hypot(
            track.image[f][a][0] - track.image[f][b][0],
            track.image[f][a][1] - track.image[f][b][1],
          );
          const real = dist(P[a], P[b]);
          return real > 0.05 ? img / real : 0;
        })
        .sort((x, y) => y - x);
      return ratios[1] || ratios[0] || 1;
    });
    const ppmSmooth = oneEuroSeries(ppm, track.fps, 0.3, 0.02).map((v) => Math.max(1, v));
    const raw = track.image.map((img, f): Vec3 => {
      const hx = (img[LM.leftHip][0] + img[LM.rightHip][0]) / 2;
      const hy = (img[LM.leftHip][1] + img[LM.rightHip][1]) / 2;
      const s = ppmSmooth[f];
      return [(hx - w / 2) / s, -(hy - h / 2) / s, focal / s];
    });
    const o = raw[0];
    raw.forEach((r, f) => {
      root[f] = [
        (r[0] - o[0]) * unitsPerMetre * settings.rootStrength,
        (r[1] - o[1]) * unitsPerMetre * settings.rootStrength,
        (r[2] - o[2]) * unitsPerMetre * settings.rootDepthStrength,
      ];
    });
  }

  // ---- forward kinematics helpers -------------------------------------------------------------------
  const fk = (s: FrameSolve, centerOffset: Vec3): Vec3[] => {
    const pos: Vec3[] = new Array(bones.length);
    for (const i of sk.order) {
      const b = bones[i];
      const p = b.parent;
      pos[i] = p >= 0 ? add(pos[p], rotate(s.world[p], sub(b.position, bones[p].position))) : [...b.position];
      if (i === centerIdx) pos[i] = add(pos[i], centerOffset);
    }
    return pos;
  };
  const feetIdx = SIDES.map((s) => ({
    ankle: sk.index(BONE.ankle(s)),
    toe: sk.index(rest[s].toeName),
    restAnkleY: restPos(BONE.ankle(s))?.[1] ?? 1.3,
    restToeY: restPos(rest[s].toeName)?.[1] ?? 0,
  }));
  const haveFeet = feetIdx.every((f) => f.ankle >= 0);
  const toePos = (pos: Vec3[], s: FrameSolve, f: (typeof feetIdx)[number], side: Side): Vec3 =>
    f.toe >= 0 && bones[f.toe].parent === f.ankle
      ? pos[f.toe]
      : add(
          pos[f.ankle],
          rotate(
            s.world[f.ankle],
            sub(restPos(rest[side].toeName) ?? [0, 0, -1.4], restPos(BONE.ankle(side))!),
          ),
        );

  // ---- ground contact & centre height --------------------------------------------------------------
  const contacts: [boolean, boolean][] = Array.from({ length: n }, () => [false, false]);
  const centerOffset: Vec3[] = root.map((r) => [...r]);
  let ankles: Vec3[][] = [[], []];
  let footSkateBefore = 0;
  let footSkateAfter = 0;
  if (settings.lowerBody && haveFeet && centerIdx >= 0) {
    const footLow = (pos: Vec3[], s: FrameSolve): [number, number] =>
      feetIdx.map((f, k) => {
        const side = SIDES[k];
        return Math.min(pos[f.ankle][1] - f.restAnkleY, toePos(pos, s, f, side)[1] - f.restToeY);
      }) as [number, number];
    const pre = solves.map((s, f) => fk(s, root[f]));
    const lows = pre.map((pos, f) => footLow(pos, solves[f]));
    const lowest = lows.map((l) => Math.min(l[0], l[1]));
    const sorted = [...lowest].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    for (let k = 0; k < 2; k++) {
      const flags = detectContacts(
        lows.map((l) => l[k] - floor),
        pre.map((pos) => pos[feetIdx[k].ankle]),
        {
          heightThreshold: settings.contactHeight * legModel,
          speedThreshold: settings.contactSpeed * legModel,
          fps: track.fps,
        },
      );
      flags.forEach((c, f) => (contacts[f][k] = c));
    }
    // Residual that puts the supporting foot on the floor; interpolated through flight phases.
    const residual: (number | null)[] = lows.map((l, f) => {
      const c = contacts[f];
      if (!c[0] && !c[1]) return null;
      return -Math.min(c[0] ? l[0] : Infinity, c[1] ? l[1] : Infinity);
    });
    const known = residual.map((r, f) => (r === null ? -1 : f)).filter((f) => f >= 0);
    const r = residual.map((v, f) => {
      if (v !== null) return v;
      if (!known.length) return -lowest[f];
      const after = known.find((k) => k > f);
      const before = [...known].reverse().find((k) => k < f);
      if (before === undefined) return residual[after!]!;
      if (after === undefined) return residual[before]!;
      const t = (f - before) / (after - before);
      return residual[before]! + (residual[after]! - residual[before]!) * t;
    });
    const rSmooth = oneEuroSeries(r, track.fps, 1.5, 0.5);
    rSmooth.forEach((v, f) => {
      // Never let a foot sink below the floor.
      centerOffset[f][1] = root[f][1] + Math.max(v, -lowest[f]);
    });
    const skateOf = (tracks: Vec3[][]): number =>
      (footSkate(
        tracks[0],
        contacts.map((c) => c[0]),
        track.fps,
      ) +
        footSkate(
          tracks[1],
          contacts.map((c) => c[1]),
          track.fps,
        )) /
      2;
    footSkateBefore = skateOf([0, 1].map((k) => pre.map((pos) => pos[feetIdx[k].ankle])));

    // Leg odometry: while a foot is planted, move the root so that foot stays put; the image-based root
    // drives flight phases, plus a slow drift correction toward it.
    if (settings.rootStrength > 0) {
      const rel = [0, 1].map((k) =>
        solves.map((s, f) => fk(s, [0, centerOffset[f][1], 0])[feetIdx[k].ankle]),
      );
      const odo: Vec3[] = [[root[0][0], 0, root[0][2]]];
      for (let f = 1; f < n; f++) {
        let dx = 0;
        let dz = 0;
        let count = 0;
        for (let k = 0; k < 2; k++) {
          if (!contacts[f][k] || !contacts[f - 1][k]) continue;
          dx -= rel[k][f][0] - rel[k][f - 1][0];
          dz -= rel[k][f][2] - rel[k][f - 1][2];
          count++;
        }
        if (count) {
          dx /= count;
          dz /= count;
        } else {
          dx = root[f][0] - root[f - 1][0];
          dz = root[f][2] - root[f - 1][2];
        }
        odo.push([odo[f - 1][0] + dx, 0, odo[f - 1][2] + dz]);
      }
      const driftX = oneEuroSeries(
        root.map((r, f) => r[0] - odo[f][0]),
        track.fps,
        0.15,
        0,
      );
      const driftZ = oneEuroSeries(
        root.map((r, f) => r[2] - odo[f][2]),
        track.fps,
        0.15,
        0,
      );
      for (let f = 0; f < n; f++) {
        centerOffset[f][0] = odo[f][0] + driftX[f];
        centerOffset[f][2] = odo[f][2] + driftZ[f];
      }
    }
    const finalPos = solves.map((s, f) => fk(s, centerOffset[f]));
    ankles = [0, 1].map((k) => finalPos.map((pos) => pos[feetIdx[k].ankle]));
    footSkateAfter = skateOf(ankles);
  }

  // ---- keys ----------------------------------------------------------------------------------------
  const keys: BoneKey[] = [];
  const drivenNames: string[] = [];
  for (const i of driven) {
    const name = bones[i].name;
    drivenNames.push(name);
    for (let f = 0; f < n; f++) {
      const q = solves[f].local[i];
      keys.push({ bone: name, frame: f, position: [0, 0, 0], rotation: [q[0], q[1], q[2], q[3]] });
    }
  }
  if (centerIdx >= 0 && settings.lowerBody) {
    drivenNames.push(BONE.center);
    for (let f = 0; f < n; f++)
      keys.push({ bone: BONE.center, frame: f, position: centerOffset[f], rotation: [0, 0, 0, 1] });
  }

  const properties: PropertyKey[] = [];
  const ikBones = SIDES.flatMap((s) => [BONE.legIk(s), BONE.toeIk(s)]).filter((b) => sk.has(b));
  if (settings.lowerBody && ikBones.length) {
    if (settings.footIk && haveFeet && ankles[0].length) {
      for (let k = 0; k < 2; k++) {
        const side = SIDES[k];
        const ikName = BONE.legIk(side);
        const ikIdx = sk.index(ikName);
        if (ikIdx < 0) continue;
        const flags = contacts.map((c) => c[k]);
        const pinned = pinFeet(ankles[k], flags);
        footSkateAfter =
          k === 0
            ? footSkate(pinned, flags, track.fps)
            : (footSkateAfter + footSkate(pinned, flags, track.fps)) / 2;
        const restIk = bones[ikIdx].position;
        drivenNames.push(ikName);
        for (let f = 0; f < n; f++) {
          const ankleWorld = solves[f].world[feetIdx[k].ankle];
          keys.push({
            bone: ikName,
            frame: f,
            position: sub(pinned[f], restIk),
            rotation: [ankleWorld[0], ankleWorld[1], ankleWorld[2], ankleWorld[3]],
          });
        }
      }
    } else {
      properties.push({ frame: 0, visible: true, ik: ikBones.map((bone) => ({ bone, enabled: false })) });
    }
  }

  return {
    modelName: skeleton.name,
    frameCount: n,
    keys,
    properties,
    bones: drivenNames,
    contacts,
    footSkateBefore,
    footSkateAfter,
    unitsPerMetre,
  };
}

/** Count foot contact runs (for the report). */
export const countContactRuns = (contacts: [boolean, boolean][]): number =>
  contactRuns(contacts.map((c) => c[0])).length + contactRuns(contacts.map((c) => c[1])).length;

/** Model-space bone positions for a set of local rotations (by bone name) and a センター offset. */
export function forwardKinematics(
  skeleton: Skeleton,
  locals: Map<string, Quat>,
  centerOffset: Vec3 = [0, 0, 0],
): { positions: Vec3[]; world: Quat[] } {
  const sk = new SkeletonIndex(skeleton);
  const bones = skeleton.bones;
  const positions: Vec3[] = new Array(bones.length);
  const world: Quat[] = new Array(bones.length);
  for (const i of sk.order) {
    const b = bones[i];
    const p = b.parent;
    const wp = p >= 0 ? world[p] : QI;
    world[i] = qnormalize(qmul(wp, locals.get(b.name) ?? QI));
    positions[i] =
      p >= 0 ? add(positions[p], rotate(wp, sub(b.position, bones[p].position))) : [...b.position];
    if (b.name === BONE.center) positions[i] = add(positions[i], centerOffset);
  }
  return { positions, world };
}
