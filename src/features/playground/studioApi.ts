// The sandboxed-ish API exposed to playground scripts as the global `studio`.
// Scripts run in the page, but only through this surface: every call goes through the same
// actions the UI uses, so the store, undo history and persistence stay consistent.
import type { CameraMode, CameraPreset, LightingSettings, SceneSettings } from '@/engine/types';
import type { StudioEngine } from '@/engine/StudioEngine';
import { cameraPreset, setCameraMode, setFov, setMorph, updateSettings } from '@/store/actions';
import { studio as store } from '@/store/studio';

export interface ScriptConsole {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface ModelHandle {
  readonly id: string;
  readonly name: string;
  readonly morphs: string[];
  readonly bones: string[];
  setMorph(name: string, weight: number): void;
  getMorph(name: string): number;
  setVisible(visible: boolean): void;
  /** Set a bone's local rotation as Euler angles in degrees (X, Y, Z). */
  rotateBone(name: string, x: number, y: number, z: number): void;
  /** Offset a bone's local position from its rest pose. */
  moveBone(name: string, x: number, y: number, z: number): void;
  resetPose(): void;
}

const DEG = Math.PI / 180;

function quatFromEulerDeg(x: number, y: number, z: number): [number, number, number, number] {
  // YXZ order (Babylon / MMD convention)
  const [hx, hy, hz] = [(x * DEG) / 2, (y * DEG) / 2, (z * DEG) / 2];
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(hx),
    Math.sin(hx),
    Math.cos(hy),
    Math.sin(hy),
    Math.cos(hz),
    Math.sin(hz),
  ];
  return [
    cy * sx * cz + sy * cx * sz,
    sy * cx * cz - cy * sx * sz,
    cy * cx * sz - sy * sx * cz,
    cy * cx * cz + sy * sx * sz,
  ];
}

export function createStudioApi(engine: StudioEngine, out: ScriptConsole) {
  const disposers = new Set<() => void>();
  const track = (d: () => void): (() => void) => {
    disposers.add(d);
    return () => {
      d();
      disposers.delete(d);
    };
  };

  const restPositions = new Map<string, [number, number, number][]>();

  const handle = (id: string): ModelHandle | undefined => {
    const m = store.get().models.find((x) => x.id === id);
    if (!m) return undefined;
    const boneIndex = (name: string): number => {
      const b = m.info.bones.find((x) => x.name === name);
      if (!b) throw new Error(`Bone not found: ${name}`);
      return b.index;
    };
    const rest = (i: number): [number, number, number] => {
      let list = restPositions.get(id);
      if (!list) {
        list = m.info.bones.map((b) => engine.getBoneTransform(id, b.index)?.position ?? [0, 0, 0]);
        restPositions.set(id, list);
      }
      return list[i];
    };
    return {
      id,
      name: m.name,
      morphs: m.info.morphs.map((x) => x.name),
      bones: m.info.bones.map((x) => x.name),
      setMorph: (name, weight) => setMorph(id, name, Math.min(1, Math.max(0, weight)), false),
      getMorph: (name) => engine.getMorphWeights(id)[name] ?? 0,
      setVisible: (v) => engine.setModelVisible(id, v),
      rotateBone: (name, x, y, z) => {
        const i = boneIndex(name);
        const cur = engine.getBoneTransform(id, i);
        if (cur)
          engine.setBoneTransform(id, i, { position: cur.position, rotation: quatFromEulerDeg(x, y, z) });
      },
      moveBone: (name, x, y, z) => {
        const i = boneIndex(name);
        const cur = engine.getBoneTransform(id, i);
        const r = rest(i);
        if (cur)
          engine.setBoneTransform(id, i, {
            rotation: cur.rotation,
            position: [r[0] + x, r[1] + y, r[2] + z],
          });
      },
      resetPose: () => engine.resetPose(id),
    };
  };

  const pickModel = (which?: string | number): ModelHandle | undefined => {
    const models = store.get().models;
    if (which === undefined) {
      const id = store.get().selectedModelId ?? models[0]?.id;
      return id ? handle(id) : undefined;
    }
    const m =
      typeof which === 'number' ? models[which] : models.find((x) => x.name === which || x.id === which);
    return m ? handle(m.id) : undefined;
  };

  const api = {
    /** All models in the scene. */
    get models(): ModelHandle[] {
      return store
        .get()
        .models.map((m) => handle(m.id)!)
        .filter(Boolean);
    },
    /** Get a model by name, id or index (default: selected model). */
    model: (which?: string | number) => pickModel(which),
    play: () => engine.play(),
    pause: () => engine.pause(),
    stop: () => engine.stop(),
    seek: (frame: number) => engine.seek(frame),
    get frame() {
      return engine.getPlayback().frame;
    },
    get duration() {
      return engine.getPlayback().duration;
    },
    get isPlaying() {
      return engine.getPlayback().playing;
    },
    /** Set a morph on the selected (or named) model. */
    setMorph: (name: string, weight: number, model?: string | number) => {
      const m = pickModel(model);
      if (!m) throw new Error('No model loaded');
      m.setMorph(name, weight);
    },
    getMorph: (name: string, model?: string | number) => pickModel(model)?.getMorph(name) ?? 0,
    camera: {
      get state() {
        return engine.getCameraState();
      },
      setMode: (mode: CameraMode) => setCameraMode(mode),
      setFov: (deg: number) => setFov(deg),
      preset: (p: CameraPreset) => cameraPreset(p),
      /** Orbit camera: angles in degrees around the target. */
      orbit: (alphaDeg: number, betaDeg: number, radius?: number) => {
        const s = engine.getCameraState();
        engine.setCameraState({
          ...s,
          mode: 'orbit',
          alpha: alphaDeg * DEG,
          beta: betaDeg * DEG,
          radius: radius ?? s.radius,
        });
      },
      lookAt: (x: number, y: number, z: number) => {
        const s = engine.getCameraState();
        engine.setCameraState({ ...s, target: [x, y, z] });
      },
    },
    lights: {
      get: (): LightingSettings => structuredClone(store.get().settings.lighting),
      set: (patch: Partial<LightingSettings>) => updateSettings((d) => void Object.assign(d.lighting, patch)),
    },
    /** Mutate any scene setting: studio.scene((s) => { s.postfx.bloom = true }) */
    scene: (fn: (draft: SceneSettings) => void) => updateSettings(fn),
    /** Run `cb(deltaSeconds, frame)` every rendered frame until the script is stopped. */
    onFrame: (cb: (dt: number, frame: number) => void) =>
      track(engine.onBeforeFrame((ms) => cb(ms / 1000, engine.getPlayback().frame))),
    every: (ms: number, cb: () => void) => {
      const t = setInterval(() => {
        try {
          cb();
        } catch (e) {
          out.error(e);
        }
      }, ms);
      return track(() => clearInterval(t));
    },
    after: (ms: number, cb: () => void) => {
      const t = setTimeout(() => {
        try {
          cb();
        } catch (e) {
          out.error(e);
        }
      }, ms);
      return track(() => clearTimeout(t));
    },
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    log: (...args: unknown[]) => out.log(...args),
  };

  return {
    api,
    dispose: () => {
      for (const d of disposers) d();
      disposers.clear();
    },
  };
}

export type StudioApi = ReturnType<typeof createStudioApi>['api'];

/** Type declarations injected into Monaco for autocompletion. Keep in sync with the API above. */
export const STUDIO_DTS = `
type Vec3 = [number, number, number];
type CameraMode = 'orbit' | 'fly' | 'vmd';
type CameraPreset = 'front' | 'back' | 'left' | 'right' | 'face' | 'full';
interface LightingSettings {
  dirIntensity: number; dirColor: string; dirAzimuth: number; dirElevation: number;
  ambientIntensity: number; ambientColor: string; groundColor: string;
  shadows: boolean; softShadows: boolean; shadowDarkness: number;
}
interface SceneSettings {
  viewport: { quality: 'low' | 'medium' | 'high'; showGrid: boolean; showAxes: boolean; showStats: boolean };
  lighting: LightingSettings;
  background: { mode: 'solid' | 'gradient' | 'hdr' | 'transparent'; color: string; gradientTop: string; gradientBottom: string; hdrIntensity: number; showGround: boolean };
  postfx: { bloom: boolean; bloomWeight: number; bloomThreshold: number; dof: boolean; dofFocusDistance: number; dofFStop: number; fxaa: boolean; toneMapping: 'none' | 'standard' | 'aces' | 'khr'; exposure: number; contrast: number; vignette: boolean; vignetteWeight: number; ssao: boolean; outlineScale: number };
  physics: { enabled: boolean; gravity: number; substeps: number; fixedTimeStep: number };
}
interface ModelHandle {
  readonly id: string;
  readonly name: string;
  /** Morph names (e.g. まばたき, あ). */
  readonly morphs: string[];
  /** Bone names (e.g. 頭, 上半身). */
  readonly bones: string[];
  /** Set a morph weight (0..1). */
  setMorph(name: string, weight: number): void;
  getMorph(name: string): number;
  setVisible(visible: boolean): void;
  /** Set a bone's local rotation in degrees. Overridden while a motion that keys this bone is playing. */
  rotateBone(name: string, x: number, y: number, z: number): void;
  /** Offset a bone from its rest position. */
  moveBone(name: string, x: number, y: number, z: number): void;
  resetPose(): void;
}
interface Studio {
  /** All models in the scene. */
  readonly models: ModelHandle[];
  /** A model by name, id or index; defaults to the selected model. */
  model(which?: string | number): ModelHandle | undefined;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  /** Seek to an MMD frame (30 fps). */
  seek(frame: number): void;
  readonly frame: number;
  readonly duration: number;
  readonly isPlaying: boolean;
  /** Set a morph on the selected (or given) model. */
  setMorph(name: string, weight: number, model?: string | number): void;
  getMorph(name: string, model?: string | number): number;
  camera: {
    readonly state: { mode: CameraMode; fov: number; target: Vec3; alpha: number; beta: number; radius: number };
    setMode(mode: CameraMode): void;
    setFov(degrees: number): void;
    preset(p: CameraPreset): void;
    /** Orbit around the target. Angles in degrees (alpha: around Y, beta: from the top). */
    orbit(alphaDeg: number, betaDeg: number, radius?: number): void;
    lookAt(x: number, y: number, z: number): void;
  };
  lights: { get(): LightingSettings; set(patch: Partial<LightingSettings>): void };
  /** Mutate scene settings: studio.scene(s => { s.postfx.bloom = true }) */
  scene(fn: (draft: SceneSettings) => void): void;
  /** Called every rendered frame until Stop. Returns an unsubscribe function. */
  onFrame(cb: (deltaSeconds: number, frame: number) => void): () => void;
  /** setInterval that is cleaned up on Stop. */
  every(ms: number, cb: () => void): () => void;
  /** setTimeout that is cleaned up on Stop. */
  after(ms: number, cb: () => void): () => void;
  sleep(ms: number): Promise<void>;
  log(...args: unknown[]): void;
}
declare const studio: Studio;
`;
