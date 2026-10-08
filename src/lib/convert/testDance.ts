// A procedural test dance for converted models (original, no copyrighted motion): bounce, sway, arm
// waves, elbow bends, stepping feet through leg IK, blinking and talking.

import { axisAngle, qmul } from '@/lib/math3d';
import { autoBlink, lipPattern } from '@/lib/motion/tools';
import { emptyClip, linearCurves, type BoneKey, type MotionClip, type Quat, type Vec3 } from '@/lib/motion/types';

const DEG = Math.PI / 180;

export function testDance(frames = 240): MotionClip {
  const step = 5;
  const keys = (fn: (f: number, t: number) => { p?: Vec3; r?: Quat }): BoneKey[] => {
    const out: BoneKey[] = [];
    for (let f = 0; f <= frames; f += step) {
      const t = (f / 30) * Math.PI; // one beat per second
      const v = fn(f, t);
      out.push({ f, p: v.p ?? [0, 0, 0], r: v.r ?? [0, 0, 0, 1], ip: linearCurves(4) });
    }
    return out;
  };
  const rz = (deg: number): Quat => axisAngle([0, 0, 1], deg * DEG);
  const ry = (deg: number): Quat => axisAngle([0, 1, 0], deg * DEG);
  const rx = (deg: number): Quat => axisAngle([1, 0, 0], deg * DEG);
  const bones = [
    { name: 'センター', keys: keys((_, t) => ({ p: [Math.sin(t / 2) * 0.8, -Math.abs(Math.sin(t)) * 0.5, 0] })) },
    { name: '上半身', keys: keys((_, t) => ({ r: qmul(rz(Math.sin(t / 2) * 8), ry(Math.sin(t / 2) * 10)) })) },
    { name: '頭', keys: keys((_, t) => ({ r: qmul(rx(Math.sin(t) * 6), rz(-Math.sin(t / 2) * 6)) })) },
    // Arms wave up and down (MMD space: left arm points +X; positive Z rotation raises it).
    { name: '左腕', keys: keys((_, t) => ({ r: rz(25 + Math.sin(t) * 25) })) },
    { name: '右腕', keys: keys((_, t) => ({ r: rz(-25 - Math.sin(t + Math.PI) * 25) })) },
    { name: '左ひじ', keys: keys((_, t) => ({ r: ry(-20 - Math.max(0, Math.sin(t)) * 50) })) },
    { name: '右ひじ', keys: keys((_, t) => ({ r: ry(20 + Math.max(0, Math.sin(t + Math.PI)) * 50) })) },
    // Stepping: each foot lifts on alternate beats (leg IK).
    { name: '左足ＩＫ', keys: keys((_, t) => ({ p: [0, Math.max(0, Math.sin(t)) * 1.5, -Math.max(0, Math.sin(t)) * 0.8] })) },
    { name: '右足ＩＫ', keys: keys((_, t) => ({ p: [0, Math.max(0, -Math.sin(t)) * 1.5, -Math.max(0, -Math.sin(t)) * 0.8] })) },
  ];
  let clip: MotionClip = { ...emptyClip('Test dance'), bones };
  clip = autoBlink(clip, 0, frames, { interval: 70, seed: 7 });
  clip = lipPattern(clip, 30, frames - 30, 8, 5);
  return clip;
}
