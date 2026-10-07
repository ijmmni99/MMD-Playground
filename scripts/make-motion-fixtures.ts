// Generates synthetic motion fixtures (no copyrighted data) for the Mannequin test rig:
//   e2e/fixtures/Mannequin/mannequin-dance.vmd   bones (FK + 足ＩＫ), morph-free, 4 s
//   e2e/fixtures/Mannequin/mannequin-camera.vmd  camera track, 4 s
// Run: pnpm exec jiti scripts/make-motion-fixtures.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { axisAngle, qmul } from '../src/lib/math3d';
import { BONE_CHANNELS, CAMERA_CHANNELS, emptyClip, linearCurves, type BoneTrack, type MotionClip, type Quat, type Vec3 } from '../src/lib/motion/types';
import { writeVmd } from '../src/lib/motion/vmd';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'e2e/fixtures/Mannequin');
mkdirSync(out, { recursive: true });

const F = 120;
const tracks: BoneTrack[] = [];
const track = (name: string, step: number, fn: (f: number) => { p?: Vec3; r?: Quat }): void => {
  const keys = [];
  for (let f = 0; f <= F; f += step) {
    const v = fn(f);
    keys.push({ f, p: v.p ?? ([0, 0, 0] as Vec3), r: v.r ?? ([0, 0, 0, 1] as Quat), ip: linearCurves(BONE_CHANNELS) });
  }
  tracks.push({ name, keys });
};
const ph = (f: number): number => (f / 30) * Math.PI; // one cycle per 2 s
track('センター', 5, (f) => ({ p: [Math.sin(ph(f)) * 1.2, -Math.abs(Math.sin(ph(f) * 2)) * 0.4, 0] }));
track('上半身', 5, (f) => ({ r: qmul(axisAngle([0, 1, 0], Math.sin(ph(f)) * 0.35), axisAngle([1, 0, 0], 0.08)) }));
track('頭', 10, (f) => ({ r: axisAngle([0, 1, 0], -Math.sin(ph(f)) * 0.3) }));
track('左腕', 5, (f) => ({ r: qmul(axisAngle([0, 0, 1], 0.35 + Math.sin(ph(f) * 2) * 0.5), axisAngle([0, 1, 0], 0.2)) }));
track('右腕', 5, (f) => ({ r: qmul(axisAngle([0, 0, 1], -0.35 - Math.cos(ph(f) * 2) * 0.5), axisAngle([0, 1, 0], -0.2)) }));
track('左ひじ', 10, (f) => ({ r: axisAngle([0, 1, 0], -0.4 - Math.abs(Math.sin(ph(f))) * 0.8) }));
track('右ひじ', 10, (f) => ({ r: axisAngle([0, 1, 0], 0.4 + Math.abs(Math.cos(ph(f))) * 0.8) }));
// Step-touch with the feet: each IK target lifts in turn.
track('左足ＩＫ', 5, (f) => ({ p: [Math.sin(ph(f)) * 1.2 + 0.4, Math.max(0, Math.sin(ph(f) * 2)) * 1.2, 0] }));
track('右足ＩＫ', 5, (f) => ({ p: [Math.sin(ph(f)) * 1.2 - 0.4, Math.max(0, -Math.sin(ph(f) * 2)) * 1.2, 0] }));

const dance: MotionClip = { ...emptyClip('マネキン'), bones: tracks };
writeFileSync(join(out, 'mannequin-dance.vmd'), new Uint8Array(writeVmd(dance)));

const camera: MotionClip = {
  ...emptyClip('カメラ・照明'),
  camera: [0, 60, 120].map((f) => ({
    f,
    t: [0, 10, 0] as Vec3,
    r: [0.05, (f / 120) * 0.8, 0] as Vec3,
    d: -40 + f / 12,
    fov: 30,
    persp: true,
    ip: linearCurves(CAMERA_CHANNELS),
  })),
};
writeFileSync(join(out, 'mannequin-camera.vmd'), new Uint8Array(writeVmd(camera)));
console.log('wrote mannequin-dance.vmd and mannequin-camera.vmd');
