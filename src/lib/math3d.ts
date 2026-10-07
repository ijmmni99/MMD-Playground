// Minimal vector / quaternion helpers (worker-safe, no Babylon dependency).
// Quaternions are [x, y, z, w] and rotate vectors as v' = q v q*. Coordinates are MMD's (left-handed,
// Y up); the algebra is handedness-agnostic as long as everything stays in the same space.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const mid = (a: Vec3, b: Vec3): Vec3 => lerp3(a, b, 0.5);

export function normalize(a: Vec3, fallback: Vec3 = [0, 1, 0]): Vec3 {
  const l = length(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [...fallback];
}

export const QI: Quat = [0, 0, 0, 1];

export function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export const qdot = (a: Quat, b: Quat): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
export const qneg = (q: Quat): Quat => [-q[0], -q[1], -q[2], -q[3]];

export function qnormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 1e-12 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [...QI];
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v); v' = v + w t + cross(q.xyz, t)
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

export function axisAngle(axis: Vec3, angle: number): Quat {
  const a = normalize(axis);
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}

/** Rotation angle in radians (0..π). */
export function qangle(q: Quat): number {
  return 2 * Math.acos(Math.min(1, Math.abs(q[3])));
}

/** Shortest rotation taking direction a to direction b. */
export function fromTo(a: Vec3, b: Vec3): Quat {
  const na = normalize(a);
  const nb = normalize(b);
  const d = dot(na, nb);
  if (d < -0.999999) {
    let axis = cross([1, 0, 0], na);
    if (length(axis) < 1e-6) axis = cross([0, 1, 0], na);
    return axisAngle(axis, Math.PI);
  }
  const c = cross(na, nb);
  return qnormalize([c[0], c[1], c[2], 1 + d]);
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  let bb = b;
  let d = qdot(a, b);
  if (d < 0) {
    bb = qneg(b);
    d = -d;
  }
  if (d > 0.9995) {
    return qnormalize([
      a[0] + (bb[0] - a[0]) * t,
      a[1] + (bb[1] - a[1]) * t,
      a[2] + (bb[2] - a[2]) * t,
      a[3] + (bb[3] - a[3]) * t,
    ]);
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
}

/** Rotation matrix (column vectors e1, e2, e3) to quaternion. */
export function quatFromBasis(e1: Vec3, e2: Vec3, e3: Vec3): Quat {
  const m00 = e1[0],
    m10 = e1[1],
    m20 = e1[2];
  const m01 = e2[0],
    m11 = e2[1],
    m21 = e2[2];
  const m02 = e3[0],
    m12 = e3[1],
    m22 = e3[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qnormalize(q);
}

/**
 * Orientation of the frame spanned by a primary direction and a secondary (twist) direction:
 * e1 = primary, e3 = primary × secondary, e2 = e3 × e1.
 */
export function frameQuat(primary: Vec3, secondary: Vec3): Quat {
  const e1 = normalize(primary);
  let e3 = cross(e1, secondary);
  if (length(e3) < 1e-6) e3 = cross(e1, Math.abs(e1[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  e3 = normalize(e3);
  const e2 = cross(e3, e1);
  return quatFromBasis(e1, e2, e3);
}

/** Rotation taking the rest frame (primary, secondary) onto the target frame. */
export function frameRotation(restP: Vec3, restS: Vec3, targetP: Vec3, targetS: Vec3): Quat {
  return qnormalize(qmul(frameQuat(targetP, targetS), qconj(frameQuat(restP, restS))));
}

/** Clamp the rotation angle of q to maxAngle (radians). */
export function clampAngle(q: Quat, maxAngle: number): Quat {
  const qq = q[3] < 0 ? qneg(q) : q;
  const angle = qangle(qq);
  if (angle <= maxAngle) return qq;
  return slerp(QI, qq, maxAngle / angle);
}

/** Scale a rotation's angle (0 = identity, 1 = unchanged). */
export const damp = (q: Quat, t: number): Quat => slerp(QI, q, t);

/** Axis of a rotation (unit), or null for ~identity. */
export function qaxis(q: Quat): Vec3 | null {
  const s = Math.hypot(q[0], q[1], q[2]);
  return s < 1e-8 ? null : [q[0] / s, q[1] / s, q[2] / s];
}

/** Angular distance between two rotations (radians). */
export function qdistance(a: Quat, b: Quat): number {
  return 2 * Math.acos(Math.min(1, Math.abs(qdot(a, b))));
}
