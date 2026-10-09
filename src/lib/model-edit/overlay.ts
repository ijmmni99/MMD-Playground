// Wireframe lines for the physics overlay: rigid bodies (sphere / box / capsule) and joints, in rest pose,
// placed with the model's transform. Physics-driven bodies are orange, bone-following ones blue, the
// selected one white.

import type { PmxModel, V3 } from '@/lib/convert/pmx/types';

type Seg = { a: V3; b: V3; color: V3 };
interface Transform {
  position: V3;
  rotation: V3;
  scale: number;
}

const DEG = Math.PI / 180;

/** Rotation from PMX euler angles (applied as yaw · pitch · roll, like Babylon's RotationYawPitchRoll). */
export function eulerMatrix(r: V3): number[] {
  const [x, y, z] = r;
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  // R = Ry · Rx · Rz (column vectors), row-major 3×3.
  return [
    cy * cz + sy * sx * sz,
    -cy * sz + sy * sx * cz,
    sy * cx,
    cx * sz,
    cx * cz,
    -sx,
    -sy * cz + cy * sx * sz,
    sy * sz + cy * sx * cz,
    cy * cx,
  ];
}

const mul = (m: number[], v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

function circle(c: V3, rot: number[], r: number, axis: 0 | 1 | 2, n = 16, offset = 0): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p: V3 = [0, 0, 0];
    const [u, v] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    p[u] = Math.cos(a) * r;
    p[v] = Math.sin(a) * r;
    if (axis === 1) p[1] = offset;
    const w = mul(rot, p);
    pts.push([c[0] + w[0], c[1] + w[1], c[2] + w[2]]);
  }
  return pts;
}

export function physicsLines(m: PmxModel, t?: Transform, selected: number | null = null): Seg[] {
  const out: Seg[] = [];
  const tr = t ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
  const modelRot = eulerMatrix([tr.rotation[0] * DEG, tr.rotation[1] * DEG, tr.rotation[2] * DEG]);
  const world = (p: V3): V3 => {
    const r = mul(modelRot, [p[0] * tr.scale, p[1] * tr.scale, p[2] * tr.scale]);
    return [r[0] + tr.position[0], r[1] + tr.position[1], r[2] + tr.position[2]];
  };
  const poly = (pts: V3[], color: V3): void => {
    for (let i = 1; i < pts.length; i++) out.push({ a: world(pts[i - 1]), b: world(pts[i]), color });
  };
  m.rigidBodies.forEach((rb, i) => {
    const color: V3 = i === selected ? [1, 1, 1] : rb.mode === 0 ? [0.3, 0.6, 1] : [1, 0.55, 0.15];
    const rot = eulerMatrix(rb.rotation);
    const c = rb.position;
    if (rb.shape === 0) {
      for (const ax of [0, 1, 2] as const) poly(circle(c, rot, rb.size[0], ax), color);
    } else if (rb.shape === 1) {
      const [x, y, z] = rb.size;
      const corners: V3[] = [];
      for (const sx of [-1, 1])
        for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx * x, sy * y, sz * z]);
      const w = corners.map((p) => {
        const q = mul(rot, p);
        return [c[0] + q[0], c[1] + q[1], c[2] + q[2]] as V3;
      });
      for (let a = 0; a < 8; a++)
        for (let b = a + 1; b < 8; b++) {
          const d = a ^ b;
          if (d === 1 || d === 2 || d === 4) poly([w[a], w[b]], color);
        }
    } else {
      const r = rb.size[0];
      const h = rb.size[1] / 2;
      poly(circle(c, rot, r, 1, 16, h), color);
      poly(circle(c, rot, r, 1, 16, -h), color);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const a = mul(rot, [dx * r, h, dz * r]);
        const b = mul(rot, [dx * r, -h, dz * r]);
        poly(
          [
            [c[0] + a[0], c[1] + a[1], c[2] + a[2]],
            [c[0] + b[0], c[1] + b[1], c[2] + b[2]],
          ],
          color,
        );
      }
    }
  });
  for (const j of m.joints) {
    const a = m.rigidBodies[j.a]?.position;
    const b = m.rigidBodies[j.b]?.position;
    if (a && b) {
      poly([a, j.position], [0.9, 0.9, 0.3]);
      poly([j.position, b], [0.9, 0.9, 0.3]);
    }
  }
  return out;
}
