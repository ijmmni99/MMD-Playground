import { describe, expect, it } from 'vitest';
import { evalIrradiance, skyGroundFromPoly, type RGB, type SphericalPoly } from './shAmbient';

const z = (): RGB => ({ x: 0, y: 0, z: 0 });
const poly = (over: Partial<SphericalPoly>): SphericalPoly => ({
  x: z(),
  y: z(),
  z: z(),
  xx: z(),
  yy: z(),
  zz: z(),
  yz: z(),
  zx: z(),
  xy: z(),
  ...over,
});

describe('shAmbient', () => {
  it('a bright sky and dark ground give a brighter up than down', () => {
    // Constant 0.5 (spread over the squares) plus a vertical gradient.
    const p = poly({
      xx: { x: 0.5, y: 0.5, z: 0.5 },
      yy: { x: 0.5, y: 0.5, z: 0.5 },
      zz: { x: 0.5, y: 0.5, z: 0.5 },
      y: { x: 0.4, y: 0.4, z: 0.4 },
    });
    const { sky, ground } = skyGroundFromPoly(p);
    expect(sky[0]).toBeCloseTo(0.9);
    expect(ground[0]).toBeCloseTo(0.1);
  });

  it('is tinted by the per-channel coefficients and clamps negatives to zero', () => {
    const p = poly({ yy: { x: 1, y: 0.5, z: 0 }, y: { x: 0, y: 0, z: -3 } });
    expect(evalIrradiance(p, [0, 1, 0])).toEqual([1, 0.5, 0]);
    expect(evalIrradiance(p, [0, -1, 0])[2]).toBe(3);
  });
});
