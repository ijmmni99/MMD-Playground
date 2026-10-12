/** Ambient colour from an environment map's spherical polynomial (the form Babylon computes for IBL). */

export interface RGB {
  x: number;
  y: number;
  z: number;
}

export interface SphericalPoly {
  x: RGB;
  y: RGB;
  z: RGB;
  xx: RGB;
  yy: RGB;
  zz: RGB;
  yz: RGB;
  zx: RGB;
  xy: RGB;
}

/** Irradiance colour (r, g, b) seen by a surface facing `dir` (unit vector). Negative lobes clamp to 0. */
export function evalIrradiance(p: SphericalPoly, dir: [number, number, number]): [number, number, number] {
  const [dx, dy, dz] = dir;
  const out: [number, number, number] = [0, 0, 0];
  const terms: [RGB, number][] = [
    [p.x, dx],
    [p.y, dy],
    [p.z, dz],
    [p.xx, dx * dx],
    [p.yy, dy * dy],
    [p.zz, dz * dz],
    [p.yz, dy * dz],
    [p.zx, dz * dx],
    [p.xy, dx * dy],
  ];
  for (const [c, w] of terms) {
    out[0] += c.x * w;
    out[1] += c.y * w;
    out[2] += c.z * w;
  }
  return [Math.max(0, out[0]), Math.max(0, out[1]), Math.max(0, out[2])];
}

/** Sky (facing up) and ground (facing down) ambient colours for toon shading. */
export function skyGroundFromPoly(p: SphericalPoly): {
  sky: [number, number, number];
  ground: [number, number, number];
} {
  return { sky: evalIrradiance(p, [0, 1, 0]), ground: evalIrradiance(p, [0, -1, 0]) };
}
