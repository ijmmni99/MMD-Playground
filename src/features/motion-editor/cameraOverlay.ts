// Camera Director viewport overlay: the camera's 3D eye path, key positions, the current frustum, and
// a draggable gizmo on the selected camera key (moving the eye; the target stays).

import { cameraEye, cameraFromEyeTarget, cutFrames } from '@/lib/motion/camera';
import { sampleCamera } from '@/lib/motion/evaluate';
import { rotate } from '@/lib/math3d';
import { eulerToQuat } from '@/lib/motion/curves';
import { CAMERA_TRACK, parseKeyId, type CameraKey } from '@/lib/motion/types';
import { engineOrNull } from '@/store/engineRef';
import { me, useMotionEditor } from '@/store/motionEditor';
import { commit } from './actions';

type V = [number, number, number];
type Seg = { a: V; b: V; color: V };

const PATH: V = [1, 0.84, 0.31];
const KEY: V = [1, 0.55, 0.2];
const FRUSTUM: V = [0.55, 0.75, 1];
const CUT: V = [1, 0.3, 0.3];

let pathCache: { keys: readonly CameraKey[]; segs: Seg[] } | null = null;

function pathSegments(keys: readonly CameraKey[]): Seg[] {
  if (pathCache?.keys === keys) return pathCache.segs;
  const segs: Seg[] = [];
  if (keys.length) {
    const cuts = new Set(cutFrames(keys));
    const end = keys[keys.length - 1].f;
    let prev: V | null = null;
    for (let f = keys[0].f; f <= end; f += 1) {
      const eye = cameraEye(sampleCamera(keys, f));
      // No line across a cut (the camera jumps).
      if (prev && !cuts.has(f)) segs.push({ a: prev, b: eye, color: PATH });
      prev = eye;
    }
    for (const k of keys) {
      const e = cameraEye(k);
      const c = cuts.has(k.f) ? CUT : KEY;
      const s = 0.5;
      segs.push({ a: [e[0] - s, e[1], e[2]], b: [e[0] + s, e[1], e[2]], color: c });
      segs.push({ a: [e[0], e[1] - s, e[2]], b: [e[0], e[1] + s, e[2]], color: c });
      segs.push({ a: [e[0], e[1], e[2] - s], b: [e[0], e[1], e[2] + s], color: c });
    }
  }
  pathCache = { keys, segs };
  return segs;
}

function frustum(keys: readonly CameraKey[], frame: number): Seg[] {
  if (!keys.length) return [];
  const s = sampleCamera(keys, frame);
  const eye = cameraEye(s);
  const q = eulerToQuat([-s.r[0], -s.r[1], -s.r[2]]);
  const depth = Math.min(8, Math.max(2, Math.abs(s.d) * 0.25));
  const h = Math.tan((s.fov * Math.PI) / 180 / 2) * depth;
  const w = h * (16 / 9);
  const corners = (
    [
      [-w, -h],
      [w, -h],
      [w, h],
      [-w, h],
    ] as const
  ).map(([x, y]) => {
    const p = rotate(q, [x, y, depth]);
    return [eye[0] + p[0], eye[1] + p[1], eye[2] + p[2]] as V;
  });
  const out: Seg[] = corners.map((c) => ({ a: eye, b: c, color: FRUSTUM }));
  for (let i = 0; i < 4; i++) out.push({ a: corners[i], b: corners[(i + 1) % 4], color: FRUSTUM });
  out.push({ a: eye, b: [...s.t] as V, color: [0.5, 0.5, 0.55] });
  return out;
}

let stop: (() => void) | null = null;
let gizmoKey: string | null = null;

function syncGizmo(): void {
  const engine = engineOrNull();
  const s = me.get();
  if (!engine) return;
  const refs = [...s.selection].map(parseKeyId).filter((r) => r.kind === 'camera');
  const key =
    s.open && s.cameraPath && refs.length === 1 ? s.camera?.camera.find((k) => k.f === refs[0].f) : undefined;
  const id = key ? `${key.f}:${key.t.join()}:${key.r.join()}:${key.d}` : null;
  if (id === gizmoKey) return;
  gizmoKey = id;
  if (!key) {
    engine.setPointGizmo(null);
    return;
  }
  engine.setPointGizmo(cameraEye(key), {
    onEnd: (eye) => {
      commit(CAMERA_TRACK, 'Move camera key', (c) => ({
        ...c,
        camera: c.camera.map((k) =>
          k.f === key.f ? { ...k, ...cameraFromEyeTarget(eye, k.t, k.r[2], k.r) } : k,
        ),
      }));
    },
  });
}

export function syncCameraOverlay(): void {
  const s = me.get();
  const want = s.open && s.cameraPath;
  const engine = engineOrNull();
  if (want && !stop && engine) {
    const off = engine.onBeforeFrame(() => {
      const keys = me.get().camera?.camera ?? [];
      engine.setOverlayLines('camera', [...pathSegments(keys), ...frustum(keys, engine.getPlayback().frame)]);
    });
    stop = () => {
      off();
      engine.setOverlayLines('camera', null);
      pathCache = null;
    };
  } else if (!want && stop) {
    stop();
    stop = null;
  }
  syncGizmo();
  if (engine) engine.setPip(s.open && s.pip);
}

useMotionEditor.subscribe(syncCameraOverlay);
