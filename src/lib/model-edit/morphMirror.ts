// Mirror a vertex morph across the model's YZ plane (MMD left = +X): keep one side's offsets and copy them,
// X-negated, onto the matching vertices on the other side.

import type { PmxModel, V3 } from '@/lib/convert/pmx/types';

const EPS = 1e-3;

/** Mirror partner of every vertex (nearest vertex at (−x, y, z) within tolerance), −1 if none. */
export function mirrorVertices(m: PmxModel, tol = 0.01): Int32Array {
  const cell = Math.max(tol * 4, 1e-3);
  const key = (x: number, y: number, z: number): string =>
    `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
  const grid = new Map<string, number[]>();
  m.vertices.forEach((v, i) => {
    const k = key(...v.position);
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const out = new Int32Array(m.vertices.length).fill(-1);
  m.vertices.forEach((v, i) => {
    const [x, y, z] = v.position;
    const tx = -x;
    let best = -1;
    let bestD = tol;
    const cx = Math.round(tx / cell);
    const cy = Math.round(y / cell);
    const cz = Math.round(z / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const p = m.vertices[j].position;
            const d = Math.hypot(p[0] - tx, p[1] - y, p[2] - z);
            if (d < bestD) {
              bestD = d;
              best = j;
            }
          }
    out[i] = best;
  });
  return out;
}

export function mirrorVertexMorph(
  m: PmxModel,
  offsets: { vertex: number; offset: V3 }[],
  from: 'L' | 'R',
): { vertex: number; offset: V3 }[] {
  const pair = mirrorVertices(m);
  const onSource = (x: number): boolean => (from === 'L' ? x > EPS : x < -EPS);
  const centre = (x: number): boolean => Math.abs(x) <= EPS;
  const out = new Map<number, V3>();
  for (const o of offsets) {
    const x = m.vertices[o.vertex]?.position[0] ?? 0;
    if (onSource(x)) {
      out.set(o.vertex, o.offset);
      const j = pair[o.vertex];
      if (j >= 0) out.set(j, [-o.offset[0], o.offset[1], o.offset[2]]);
    } else if (centre(x)) out.set(o.vertex, [0, o.offset[1], o.offset[2]]);
  }
  return [...out].sort((a, b) => a[0] - b[0]).map(([vertex, offset]) => ({ vertex, offset }));
}
