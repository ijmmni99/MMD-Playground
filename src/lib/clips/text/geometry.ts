// Glyph outlines → extruded, bevelled triangle meshes (pure; em units, y up, front face toward +z).
//
// Contours are flattened from the font's path commands, sorted into outer shapes and holes by
// containment depth (works for both TrueType and CFF winding), capped with earcut and joined by
// side walls. The bevel is a quarter circle: caps keep the glyph outline, the widest ring grows by
// `bevelSize` at the middle of the depth.

import earcut from 'earcut';

export type PathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

export type Pt = [number, number];

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface ExtrudeOptions {
  /** Depth (z extent of the side walls). */
  depth: number;
  /** Bevel thickness (z) and size (outline growth); 0 = none. */
  bevel: number;
  /** Rings per bevel (quarter circle). */
  bevelSegments: number;
  /** Line segments per curve. */
  curveSegments: number;
}

/** Flatten path commands into closed polylines (duplicate closing points removed). */
export function flatten(commands: readonly PathCommand[], curveSegments: number, scale = 1): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  const n = Math.max(1, Math.round(curveSegments));
  const push = (px: number, py: number): void => {
    const last = cur[cur.length - 1];
    if (!last || Math.abs(last[0] - px * scale) > 1e-9 || Math.abs(last[1] - py * scale) > 1e-9)
      cur.push([px * scale, py * scale]);
  };
  const close = (): void => {
    if (cur.length > 1) {
      const a = cur[0];
      const b = cur[cur.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) cur.pop();
    }
    if (cur.length >= 3) out.push(cur);
    cur = [];
  };
  for (const c of commands) {
    switch (c.type) {
      case 'M':
        close();
        push(c.x, c.y);
        x = c.x;
        y = c.y;
        break;
      case 'L':
        push(c.x, c.y);
        x = c.x;
        y = c.y;
        break;
      case 'Q':
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          push(u * u * x + 2 * u * t * c.x1 + t * t * c.x, u * u * y + 2 * u * t * c.y1 + t * t * c.y);
        }
        x = c.x;
        y = c.y;
        break;
      case 'C':
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          push(
            u * u * u * x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            u * u * u * y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
          );
        }
        x = c.x;
        y = c.y;
        break;
      case 'Z':
        close();
        break;
    }
  }
  close();
  return out;
}

/** Shoelace area (positive = counter-clockwise, y up). */
export function signedArea(c: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) a += (c[j][0] - c[i][0]) * (c[j][1] + c[i][1]);
  return a / 2;
}

function inside(p: Pt, poly: readonly Pt[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}

export interface Shape {
  outer: Pt[];
  holes: Pt[][];
}

/** Group contours into shapes: even nesting depth = outer (made CCW), odd = hole of its parent (made CW). */
export function toShapes(contours: readonly Pt[][]): Shape[] {
  const list = contours
    .map((c) => ({ c, area: Math.abs(signedArea(c)) }))
    .filter((x) => x.area > 1e-12)
    .sort((a, b) => b.area - a.area);
  const depth: number[] = [];
  const parent: number[] = [];
  list.forEach((x, i) => {
    let d = 0;
    let p = -1;
    // Test a few points: a contour touching its parent's outline still lies mostly inside it.
    const probe = x.c[0];
    for (let j = 0; j < i; j++) {
      if (inside(probe, list[j].c)) {
        d++;
        if (p < 0 || list[j].area < list[p].area) p = j;
      }
    }
    depth.push(d);
    parent.push(p);
  });
  const shapes = new Map<number, Shape>();
  list.forEach((x, i) => {
    if (depth[i] % 2 === 0) {
      const outer = signedArea(x.c) > 0 ? x.c.slice() : x.c.slice().reverse();
      shapes.set(i, { outer, holes: [] });
    }
  });
  list.forEach((x, i) => {
    if (depth[i] % 2 === 1) {
      const s = shapes.get(parent[i]);
      if (s) s.holes.push(signedArea(x.c) < 0 ? x.c.slice() : x.c.slice().reverse());
    }
  });
  return [...shapes.values()];
}

/** Grows triangle / vertex buffers. */
class Builder {
  p: number[] = [];
  n: number[] = [];
  i: number[] = [];
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    return this.p.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.i.push(a, b, c);
  }
  build(): MeshData {
    return {
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      indices: new Uint32Array(this.i),
    };
  }
}

/** Smooth-shading threshold between adjacent wall edges. */
const SMOOTH_COS = Math.cos((35 * Math.PI) / 180);

interface RingVertex {
  /** Outline point. */
  p: Pt;
  /** Miter direction × length for a unit offset. */
  miter: Pt;
  /** 2D outward normal for shading. */
  n: Pt;
}

/** Contour → wall vertices: one per point, two at sharp corners (flat shading across them). */
function ringVertices(c: readonly Pt[], offset: number): RingVertex[] {
  const len = c.length;
  const edgeN: Pt[] = [];
  const edgeL: number[] = [];
  for (let i = 0; i < len; i++) {
    const a = c[i];
    const b = c[(i + 1) % len];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    edgeL.push(l);
    // CCW outer / CW hole: the right-hand normal points away from the solid.
    edgeN.push([dy / l, -dx / l]);
  }
  const out: RingVertex[] = [];
  for (let i = 0; i < len; i++) {
    const n0 = edgeN[(i - 1 + len) % len];
    const n1 = edgeN[i];
    let mx = n0[0] + n1[0];
    let my = n0[1] + n1[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) {
      mx = n1[0];
      my = n1[1];
    } else {
      mx /= ml;
      my /= ml;
    }
    // Miter length 1/cos(half angle), limited so spikes stay small.
    const cosHalf = Math.max(0.35, mx * n1[0] + my * n1[1]);
    // Short edges / tight corners: shrink the offset so the bevel ring doesn't fold over itself.
    const room = (0.45 * Math.min(edgeL[i], edgeL[(i - 1 + len) % len])) / Math.max(1e-9, offset / cosHalf);
    const k = Math.min(1, room) / cosHalf;
    const miter: Pt = [mx * k, my * k];
    if (n0[0] * n1[0] + n0[1] * n1[1] >= SMOOTH_COS) out.push({ p: c[i], miter, n: [mx, my] });
    else {
      out.push({ p: c[i], miter, n: n0 });
      out.push({ p: c[i], miter, n: n1 });
    }
  }
  return out;
}

/** Extrude 2D shapes into a closed mesh. */
export function extrudeShapes(shapes: readonly Shape[], o: ExtrudeOptions): MeshData {
  const b = new Builder();
  const half = o.depth / 2;
  const bt = Math.max(0, o.bevel);
  const bs = Math.max(0, o.bevel);
  const segs = bt > 0 ? Math.max(1, Math.round(o.bevelSegments)) : 0;
  // Rings front → back: (offset, z, normal xy weight, normal z).
  const rings: { off: number; z: number; s: number; nz: number }[] = [];
  for (let k = 0; k <= segs; k++) {
    const th = segs ? (k / segs) * (Math.PI / 2) : Math.PI / 2;
    rings.push({ off: bs * Math.sin(th), z: half + bt * Math.cos(th), s: Math.sin(th), nz: Math.cos(th) });
  }
  for (let k = segs; k >= 0; k--) {
    const r = rings[k];
    rings.push({ off: r.off, z: -r.z, s: r.s, nz: -r.nz });
  }
  const capZ = half + bt;

  for (const shape of shapes) {
    // Caps.
    const flat: number[] = [];
    const holeIdx: number[] = [];
    const pts: Pt[] = [];
    for (const p of shape.outer) {
      flat.push(p[0], p[1]);
      pts.push(p);
    }
    for (const h of shape.holes) {
      holeIdx.push(pts.length);
      for (const p of h) {
        flat.push(p[0], p[1]);
        pts.push(p);
      }
    }
    const tris = earcut(flat, holeIdx, 2);
    const front = pts.map((p) => b.vertex(p[0], p[1], capZ, 0, 0, 1));
    const back = pts.map((p) => b.vertex(p[0], p[1], -capZ, 0, 0, -1));
    for (let t = 0; t < tris.length; t += 3) {
      // earcut keeps the input orientation (CCW outer) → front faces +z.
      const [a, c, d] = [tris[t], tris[t + 1], tris[t + 2]];
      const ccw = triArea(pts[a], pts[c], pts[d]) > 0;
      if (ccw) {
        b.tri(front[a], front[c], front[d]);
        b.tri(back[a], back[d], back[c]);
      } else {
        b.tri(front[a], front[d], front[c]);
        b.tri(back[a], back[c], back[d]);
      }
    }
    // Walls.
    for (const contour of [shape.outer, ...shape.holes]) {
      const rv = ringVertices(contour, bs || 1);
      const m = rv.length;
      const idx: number[][] = rings.map((r) =>
        rv.map((v) => {
          const nx = v.n[0] * r.s;
          const ny = v.n[1] * r.s;
          const l = Math.hypot(nx, ny, r.nz) || 1;
          return b.vertex(
            v.p[0] + v.miter[0] * r.off,
            v.p[1] + v.miter[1] * r.off,
            r.z,
            nx / l,
            ny / l,
            r.nz / l,
          );
        }),
      );
      for (let k = 0; k < rings.length - 1; k++) {
        const r0 = idx[k];
        const r1 = idx[k + 1];
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % m;
          // Skip the zero-width quad between a split corner's two vertices.
          if (rv[i].p === rv[j].p) continue;
          // Outward-facing: (i, k) → (j, k) → (j, k+1).
          b.tri(r0[i], r1[j], r0[j]);
          b.tri(r0[i], r1[i], r1[j]);
        }
      }
    }
  }
  return b.build();
}

function triArea(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
}

/** Glyph outline commands (font units) → mesh in em units. */
export function glyphMesh(commands: readonly PathCommand[], unitsPerEm: number, o: ExtrudeOptions): MeshData {
  const contours = flatten(commands, o.curveSegments, 1 / unitsPerEm);
  return extrudeShapes(toShapes(contours), o);
}

/** Append scaled + offset copies of meshes into one buffer set. */
export function mergeMeshes(
  parts: readonly { mesh: MeshData; scale: number; dx: number; dy: number }[],
): MeshData {
  let nv = 0;
  let ni = 0;
  for (const p of parts) {
    nv += p.mesh.positions.length;
    ni += p.mesh.indices.length;
  }
  const positions = new Float32Array(nv);
  const normals = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const src = p.mesh.positions;
    for (let i = 0; i < src.length; i += 3) {
      positions[vo + i] = src[i] * p.scale + p.dx;
      positions[vo + i + 1] = src[i + 1] * p.scale + p.dy;
      positions[vo + i + 2] = src[i + 2] * p.scale;
    }
    normals.set(p.mesh.normals, vo);
    const base = vo / 3;
    for (let i = 0; i < p.mesh.indices.length; i++) indices[io + i] = p.mesh.indices[i] + base;
    vo += src.length;
    io += p.mesh.indices.length;
  }
  return { positions, normals, indices };
}
