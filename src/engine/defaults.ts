import type { CameraState, SceneSettings, TransformState } from './types';

export const DEFAULT_SETTINGS: SceneSettings = {
  viewport: { quality: 'medium', showGrid: true, showAxes: false, showStats: false },
  lighting: {
    dirIntensity: 0.8,
    dirColor: '#ffffff',
    dirAzimuth: 35,
    dirElevation: 50,
    ambientIntensity: 0.6,
    ambientColor: '#ffffff',
    groundColor: '#4a4f5c',
    shadows: true,
    softShadows: true,
    shadowDarkness: 0.35,
  },
  background: {
    mode: 'gradient',
    color: '#1b1e26',
    gradientTop: '#2c3242',
    gradientBottom: '#0f1115',
    hdrName: null,
    hdrIntensity: 1,
    showGround: true,
  },
  postfx: {
    bloom: false,
    bloomWeight: 0.3,
    bloomThreshold: 0.8,
    dof: false,
    dofFocusDistance: 30,
    dofFStop: 2.8,
    fxaa: true,
    toneMapping: 'none',
    exposure: 1,
    contrast: 1,
    vignette: false,
    vignetteWeight: 1.5,
    ssao: false,
    outlineScale: 1,
  },
  physics: { enabled: true, gravity: 98, substeps: 5, fixedTimeStep: 1 / 60 },
};

export const DEFAULT_CAMERA: CameraState = {
  mode: 'orbit',
  fov: 30,
  target: [0, 10, 0],
  alpha: -Math.PI / 2,
  beta: Math.PI / 2.2,
  radius: 40,
  follow: null,
};

export const DEFAULT_TRANSFORM: TransformState = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

export function cloneSettings(s: SceneSettings): SceneSettings {
  return structuredClone(s);
}
