// Camera geometry for two-view capture. World frame = the front camera's MMD-axis frame (x = dancer's
// left, y up, z away from the front camera). A camera at yaw θ (degrees, positive toward +X) has the
// rotation R_y(θ) = [[cos, 0, −sin], [0, 1, 0], [sin, 0, cos]] from its own MMD-axis frame to the world.
import type { Vec3 } from '@/lib/math3d';

const RAD = Math.PI / 180;

/** R_y(θ)·v: camera frame → world. */
export function camToWorld(yawDeg: number, v: Vec3): Vec3 {
  const c = Math.cos(yawDeg * RAD);
  const s = Math.sin(yawDeg * RAD);
  return [c * v[0] - s * v[2], v[1], s * v[0] + c * v[2]];
}

/** R_y(θ)ᵀ·v: world → camera frame. */
export function worldToCam(yawDeg: number, v: Vec3): Vec3 {
  const c = Math.cos(yawDeg * RAD);
  const s = Math.sin(yawDeg * RAD);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

/** Camera viewing direction in the world frame. */
export const viewDir = (yawDeg: number): Vec3 => camToWorld(yawDeg, [0, 0, 1]);

/** A pinhole camera looking at the world origin's vertical axis. */
export interface PinholeCamera {
  yawDeg: number;
  /** Distance from the vertical axis through the origin (metres). */
  distance: number;
  /** Camera height (metres). */
  height: number;
  /** Image size in pixels. */
  size: [number, number];
  /** Focal length in pixels. */
  focal: number;
}

export const cameraPosition = (c: PinholeCamera): Vec3 => {
  const p = camToWorld(c.yawDeg, [0, 0, -c.distance]);
  return [p[0], c.height, p[2]];
};

/** Camera-frame coordinates (MMD axes, z = depth) of a world point. */
export function toCameraFrame(c: PinholeCamera, p: Vec3): Vec3 {
  const o = cameraPosition(c);
  return worldToCam(c.yawDeg, [p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
}

/** Normalised image coordinates (x right, y down, 0..1) of a world point, and its depth. */
export function project(c: PinholeCamera, p: Vec3): [number, number, number] {
  const q = toCameraFrame(c, p);
  const z = Math.max(1e-6, q[2]);
  return [0.5 + (c.focal * q[0]) / z / c.size[0], 0.5 - (c.focal * q[1]) / z / c.size[1], z];
}

/** Focal length in pixels for a horizontal field of view. */
export const focalFromFov = (fovDeg: number, width: number): number =>
  width / 2 / Math.tan((Math.max(10, Math.min(150, fovDeg)) * RAD) / 2);

/** Horizontal FOV for a focal length in pixels. */
export const fovFromFocal = (focal: number, width: number): number =>
  (2 * Math.atan(width / 2 / focal)) / RAD;
