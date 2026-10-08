// Camera Director actions: capture / view keys, look-at, presets, shake, lens, shots, markers and BPM.

import {
  addShake,
  bakeLookAt,
  cameraEye,
  cameraFromEyeTarget,
  clampCamera,
  deleteShot,
  generatePreset,
  mergeShots,
  normalizeShots,
  orbitEye,
  reorderShot,
  shotColor,
  splitShot,
  writeShotBoundaries,
  type CameraPreset,
} from '@/lib/motion/camera';
import { sampleCamera } from '@/lib/motion/evaluate';
import { bpmFromTaps } from '@/lib/motion/timing';
import {
  CAMERA_TRACK,
  parseKeyId,
  type CameraKey,
  type Marker,
  type MotionClip,
  type Shot,
  type TimingGrid,
  type Vec3,
} from '@/lib/motion/types';
import { engineOrNull } from '@/store/engineRef';
import { useHistory } from '@/store/history';
import { me } from '@/store/motionEditor';
import { toast } from '@/store/studio';
import { commit, ensureCameraClip, newId, scheduleApply, scheduleSave } from './actions';
import { playhead } from './view';

const CAMERA = CAMERA_TRACK;

/** Camera keys edit with undo (and optionally shots in the same step). */
function commitCamera(label: string, fn: (keys: CameraKey[]) => CameraKey[], shots?: Shot[]): void {
  const s = me.get();
  const before = s.camera;
  if (!before) return;
  const after: MotionClip = { ...before, camera: fn(before.camera) };
  const shotsBefore = s.shots;
  const apply = (clip: MotionClip, sh: Shot[]): void => {
    me.set((st) => ({ camera: clip, shots: sh, revision: st.revision + 1 }));
    scheduleApply(CAMERA);
    scheduleSave();
  };
  apply(after, shots ?? shotsBefore);
  useHistory.getState().push({
    label,
    undo: () => apply(before, shotsBefore),
    redo: () => apply(after, shots ?? shotsBefore),
  });
}

function setMeta<K extends 'shots' | 'markers' | 'grid'>(
  key: K,
  value: ReturnType<typeof me.get>[K],
  label: string,
): void {
  const before = me.get()[key];
  const apply = (v: typeof value): void => {
    me.set((st) => ({ [key]: v, revision: st.revision + 1 }) as Partial<ReturnType<typeof me.get>>);
    scheduleSave();
  };
  apply(value);
  useHistory.getState().push({ label, undo: () => apply(before), redo: () => apply(value) });
}

// ---------------------------------------------------------------- keys

/** Key the camera at the playhead from the current viewport (orbit) view. */
export async function captureView(): Promise<void> {
  const engine = engineOrNull();
  if (!engine) return;
  const clip = await ensureCameraClip();
  const st = engine.getCameraState();
  const eye = orbitEye(st.target, st.alpha, st.beta, st.radius);
  const f = playhead();
  const prev = clip.camera.length ? sampleCamera(clip.camera, f).r : undefined;
  const v = cameraFromEyeTarget(eye, st.target, 0, prev);
  commit(CAMERA, 'Key camera from view', (c) => {
    const key: CameraKey = {
      f,
      t: v.t,
      r: v.r,
      d: v.d,
      fov: Math.round(st.fov),
      persp: true,
      ip: c.camera.find((k) => k.f === f)?.ip ?? defaultIp(),
    };
    const camera = [...c.camera.filter((k) => k.f !== f), key].sort((a, b) => a.f - b.f);
    return { clip: { ...c, camera }, selection: [`camera\u0000${CAMERA}\u0000${f}`] };
  });
}

const defaultIp = (): number[] => Array.from({ length: 24 }, (_, i) => [20, 20, 107, 107][i % 4]);

/** Move the viewport (orbit) camera to the VMD camera's view at the playhead. */
export function viewThroughCamera(): void {
  const engine = engineOrNull();
  const cam = me.get().camera;
  if (!engine || !cam?.camera.length) return;
  const s = sampleCamera(cam.camera, engine.getPlayback().frame);
  const eye = cameraEye(s);
  const t = s.t;
  const d: Vec3 = [eye[0] - t[0], eye[1] - t[1], eye[2] - t[2]];
  const radius = Math.max(0.1, Math.hypot(...d));
  const st = engine.getCameraState();
  engine.setCameraState({
    ...st,
    mode: 'orbit',
    target: [...t],
    radius,
    beta: Math.acos(Math.max(-1, Math.min(1, d[1] / radius))),
    alpha: Math.atan2(d[2], d[0]),
    fov: s.fov,
    follow: null,
  });
}

/** Set FOV / distance on the selected camera keys (or the key at the playhead). */
export function setLens(values: { fov?: number; d?: number }): void {
  const s = me.get();
  const sel = new Set(
    [...s.selection]
      .map(parseKeyId)
      .filter((r) => r.kind === 'camera')
      .map((r) => r.f),
  );
  if (!sel.size) sel.add(playhead());
  commitCamera('Lens', (keys) =>
    clampCamera(
      keys.map((k) =>
        sel.has(k.f)
          ? {
              ...k,
              ...(values.fov !== undefined ? { fov: values.fov } : {}),
              ...(values.d !== undefined ? { d: values.d } : {}),
            }
          : k,
      ),
    ),
  );
}

export function clampAll(): void {
  commitCamera('Clamp camera', (keys) => clampCamera(keys));
}

// ---------------------------------------------------------------- look-at, presets, shake

function boneWorldPath(bone: string, frames: number[]): Map<number, Vec3> | null {
  const engine = engineOrNull();
  const modelId = me.get().modelId;
  if (!engine || !modelId) return null;
  const samples = engine.sampleModel(modelId, frames, [bone], { world: true });
  const out = new Map<number, Vec3>();
  frames.forEach((f, i) => {
    const p = samples[i]?.pos[bone];
    if (p) out.set(f, p);
  });
  return out.size ? out : null;
}

export async function lookAtBone(bone: string, from: number, to: number, step = 2): Promise<void> {
  await ensureCameraClip();
  if (!me.get().camera?.camera.length) {
    toast('info', 'Key the camera first (Key from view), then aim it.');
    return;
  }
  const frames: number[] = [];
  for (let f = from; f <= to; f++) frames.push(f);
  const path = boneWorldPath(bone, frames);
  if (!path) {
    toast('warning', `Bone ${bone} not found on the edited model.`);
    return;
  }
  commitCamera(`Look at ${bone}`, (keys) =>
    bakeLookAt(keys, from, to, (f) => path.get(Math.round(f)) ?? path.get(from)!, step),
  );
}

export async function applyPreset(
  preset: CameraPreset,
  from: number,
  to: number,
  opts: { distance?: number; fov?: number } = {},
): Promise<void> {
  await ensureCameraClip();
  const s = me.get();
  const frames = [from];
  const center = boneWorldPath('上半身', frames) ?? boneWorldPath('センター', frames);
  const head = boneWorldPath('頭', frames);
  const subject: Vec3 = center?.get(from) ?? [0, 10, 0];
  commitCamera(`Camera preset: ${preset}`, (keys) =>
    generatePreset(keys, preset, {
      from,
      to,
      subject,
      face: head?.get(from),
      grid: s.grid.bpm > 0 ? s.grid : undefined,
      distance: opts.distance,
      fov: opts.fov,
    }),
  );
}

export function applyShake(
  from: number,
  to: number,
  amplitude: number,
  frequency: number,
  seed: number,
): void {
  if (!me.get().camera?.camera.length) return;
  commitCamera('Handheld shake', (keys) => addShake(keys, from, to, { amplitude, frequency, seed }));
}

// ---------------------------------------------------------------- shots

export function addShot(from: number, to: number): void {
  const s = me.get();
  const shots = normalizeShots([
    ...s.shots.filter((x) => x.end < from || x.start > to),
    {
      id: newId('shot'),
      name: `Shot ${s.shots.length + 1}`,
      start: from,
      end: to,
      color: shotColor(s.shots.length),
      transition: 'cut',
    },
  ]);
  setMeta('shots', shots, 'Add shot');
}

export function shotsFromMarkers(): void {
  const s = me.get();
  const end = s.camera?.camera.length ? s.camera.camera[s.camera.camera.length - 1].f : 0;
  const cuts = [...new Set(s.markers.map((m) => m.f))].sort((a, b) => a - b).filter((f) => f > 0 && f < end);
  const bounds = [0, ...cuts, end + 1];
  const shots: Shot[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    shots.push({
      id: newId('shot'),
      name: `Shot ${i + 1}`,
      start: bounds[i],
      end: bounds[i + 1] - 1,
      color: shotColor(i),
      transition: 'cut',
    });
  }
  if (shots.length) setMeta('shots', shots, 'Shots from markers');
}

export function splitShotAt(f: number): void {
  const s = me.get();
  if (!s.shots.some((x) => f > x.start && f <= x.end)) {
    toast('info', 'Put the playhead inside a shot to split it.');
    return;
  }
  const shots = splitShot(s.shots, f, newId('shot'));
  commitCamera('Split shot', (keys) => writeShotBoundaries(keys, shots), shots);
}

export function mergeShot(id: string): void {
  const shots = mergeShots(me.get().shots, id);
  commitCamera('Merge shots', (keys) => writeShotBoundaries(keys, shots), shots);
}

export function moveShot(id: string, to: number): void {
  const s = me.get();
  if (!s.camera) return;
  const r = reorderShot(s.camera.camera, s.shots, id, to);
  commitCamera('Reorder shots', () => r.keys, r.shots);
}

export function removeShot(id: string): void {
  const s = me.get();
  if (!s.camera) return;
  const r = deleteShot(s.camera.camera, s.shots, id);
  commitCamera('Delete shot', () => r.keys, r.shots);
}

export function updateShot(id: string, patch: Partial<Shot>): void {
  const shots = me.get().shots.map((x) => (x.id === id ? { ...x, ...patch } : x));
  if (patch.transition)
    commitCamera(`Shot ${patch.transition}`, (keys) => writeShotBoundaries(keys, shots), shots);
  else setMeta('shots', normalizeShots(shots), 'Edit shot');
}

/** Rewrite all shot boundaries (cut pairs / blends) into the camera keys. */
export function writeCuts(): void {
  const s = me.get();
  commitCamera('Write cuts', (keys) => writeShotBoundaries(keys, s.shots));
}

// ---------------------------------------------------------------- markers & BPM

export function addMarker(f = playhead(), name?: string): void {
  const s = me.get();
  const m: Marker = { id: newId('mk'), f, name: name ?? `M${s.markers.length + 1}` };
  setMeta(
    'markers',
    [...s.markers, m].sort((a, b) => a.f - b.f),
    'Add marker',
  );
}

export function updateMarker(id: string, patch: Partial<Marker>): void {
  setMeta(
    'markers',
    me
      .get()
      .markers.map((m) => (m.id === id ? { ...m, ...patch } : m))
      .sort((a, b) => a.f - b.f),
    'Edit marker',
  );
}

export function removeMarker(id: string): void {
  setMeta(
    'markers',
    me.get().markers.filter((m) => m.id !== id),
    'Delete marker',
  );
}

export function setGrid(patch: Partial<TimingGrid>): void {
  setMeta('grid', { ...me.get().grid, ...patch }, 'Timing grid');
}

let taps: number[] = [];
/** Tap tempo: returns the BPM so far (applies it after 4 taps). */
export function tapTempo(now = performance.now()): number {
  if (taps.length && now - taps[taps.length - 1] > 2500) taps = [];
  taps.push(now);
  const bpm = bpmFromTaps(taps);
  if (taps.length >= 4 && bpm > 0) {
    const s = me.get();
    me.set({ grid: { ...s.grid, bpm: Math.round(bpm * 10) / 10 } });
    scheduleSave();
  }
  return bpm;
}
