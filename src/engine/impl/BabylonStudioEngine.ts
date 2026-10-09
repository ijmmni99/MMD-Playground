import {
  AbstractEngine,
  ArcRotateCamera,
  ArcRotateCameraPointersInput,
  AssetContainer,
  AxesViewer,
  Camera,
  Color3,
  Color4,
  CreateGround,
  CreateLineSystem,
  CubeTexture,
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HDRCubeTexture,
  HemisphericLight,
  ImageProcessingConfiguration,
  Layer,
  LoadAssetContainerAsync,
  Matrix,
  Mesh,
  StandardMaterial,
  VertexData,
  PositionGizmo,
  Quaternion,
  RotationGizmo,
  ScaleGizmo,
  SSAO2RenderingPipeline,
  Scene,
  SceneInstrumentation,
  ShadowGenerator,
  TransformNode,
  UniversalCamera,
  UtilityLayerRenderer,
  Vector3,
  Viewport,
  WebGPUEngine,
  type AbstractMesh,
  type BaseTexture,
  type LinesMesh,
} from '@babylonjs/core';
import { GridMaterial, ShadowOnlyMaterial } from '@babylonjs/materials';
import {
  GetMmdWasmInstance,
  MmdBulletPhysics,
  MmdCamera,
  MmdRuntime,
  MmdStandardMaterial,
  MmdStandardMaterialProxy,
  MmdWasmInstanceTypeSPR,
  MultiPhysicsRuntime,
  RegisterDxBmpTextureLoader,
  SdefInjector,
  VmdLoader,
  type MmdAnimation,
  type MmdMesh,
  type MmdModel,
  type MmdModelMetadata,
  type MmdRuntimeAnimationHandle,
} from 'babylon-mmd';
import { Emitter } from '../emitter';
import { DEFAULT_CAMERA, DEFAULT_SETTINGS } from '../defaults';
import type {
  BoneLocalTransform,
  GizmoMode,
  LoadModelOptions,
  RecordProgress,
  StudioEngine,
  StudioEvents,
  TextItem,
} from '../StudioEngine';
import type {
  AudioInfo,
  BoneInfo,
  CameraMode,
  CameraMotionInfo,
  CameraPreset,
  CameraState,
  MaterialInfo,
  ModelInfo,
  ModelRuntimeState,
  MorphCategory,
  MorphInfo,
  MotionInfo,
  PlaybackState,
  PoseData,
  QualityPreset,
  RecordOptions,
  SceneSettings,
  ScreenshotOptions,
  TransformState,
  VFile,
} from '../types';
import { AudioSync } from './AudioSync';
import { prepareModelFiles } from './modelFiles';
import { TextLayer, type TextPointerHandlers } from './TextLayer';
import { PNG_SEQUENCE_MIME, recordDeterministic, recordPngSequence, recordRealtime } from './recording';
import { basename, stripExt } from '@/lib/paths';
import { buildMmdAnimation } from '../motion/buildAnimation';
import type { MotionClip } from '@/lib/motion/types';
import { isCoarsePointer, textureCap } from '@/lib/device';
import { nearestWithin } from '@/lib/gestures';

const CATEGORY: Record<number, MorphCategory> = {
  0: 'system',
  1: 'eyebrow',
  2: 'eye',
  3: 'mouth',
  4: 'other',
};
const HEAD_BONES = ['頭', 'head', 'Head'];
const DEG = Math.PI / 180;

interface ModelEntry {
  id: string;
  name: string;
  container: AssetContainer;
  mesh: MmdMesh;
  model: MmdModel;
  info: ModelInfo;
  physics: boolean;
  visible: boolean;
  stage: boolean;
  motion: { animation: MmdAnimation; handle: MmdRuntimeAnimationHandle } | null;
  baseOutline: number[];
  materialState: { visible: boolean; outline: boolean; alpha: number }[];
  transform: TransformState;
  restPositions: Vector3[];
  /** IK chains from the PMX (bone indices). */
  ikChains: { bone: number; target: number; links: number[] }[];
  ikEnabled: boolean;
  /** Original `beforePhysics` (wrapped when IK is disabled so the property track can't re-enable it). */
  rawBeforePhysics?: (frame: number | null) => void;
}

let idCounter = 0;
const newId = (): string => `m${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function hexColor(hex: string): Color3 {
  return Color3.FromHexString(hex.length === 7 ? hex : '#ffffff');
}

export class BabylonStudioEngine implements StudioEngine {
  readonly events = new Emitter<StudioEvents>();
  physicsAvailable = false;
  webgpu = false;

  private engine!: AbstractEngine;
  private scene!: Scene;
  private runtime!: MmdRuntime;
  private physicsRuntime: MultiPhysicsRuntime | null = null;
  private vmdLoader!: VmdLoader;
  private orbit!: ArcRotateCamera;
  private fly!: UniversalCamera;
  private mmdCamera!: MmdCamera;
  private cameraMode: CameraMode = 'orbit';
  private cameraMotion: { animation: MmdAnimation; handle: MmdRuntimeAnimationHandle } | null = null;
  private dirLight!: DirectionalLight;
  private hemiLight!: HemisphericLight;
  private shadowGen!: ShadowGenerator;
  private shadowGround!: Mesh;
  private grid!: Mesh;
  private axes: AxesViewer | null = null;
  private bgLayer: Layer | null = null;
  private bgTexture: DynamicTexture | null = null;
  private hdrTexture: BaseTexture | null = null;
  private skybox: Mesh | null = null;
  private pipeline!: DefaultRenderingPipeline;
  private pointNode!: TransformNode;
  private pointGizmo!: PositionGizmo;
  private pointCb: {
    onChange?: (p: [number, number, number]) => void;
    onEnd?: (p: [number, number, number]) => void;
  } | null = null;
  private pip = false;
  private ssao: SSAO2RenderingPipeline | null = null;
  private instrumentation!: SceneInstrumentation;
  private readonly models = new Map<string, ModelEntry>();
  private readonly audio = new AudioSync();
  private settings: SceneSettings = structuredClone(DEFAULT_SETTINGS);
  private appliedQuality: QualityPreset | null = null;
  private loop = false;
  private speed = 1;
  private follow: { modelId: string; bone: string } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastStats = 0;
  private lastPlaybackEmit = 0;
  private cameraEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private capturing = false;
  private disposed = false;
  private renderPaused = false;
  /** Touch-first device: caps pixel ratio and texture sizes. */
  private readonly coarse = isCoarsePointer();

  // posing
  private utilLayer!: UtilityLayerRenderer;
  private gizmoProxy!: TransformNode;
  private rotationGizmo!: RotationGizmo;
  private positionGizmo!: PositionGizmo;
  private gizmoMode: GizmoMode = 'rotate';
  private scaleGizmo!: ScaleGizmo;
  /** Moves the whole active model (on-screen "move" mode): floor plane plus X / Y / Z arrows. */
  private moveGizmo!: PositionGizmo;
  private moveStart: TransformState | null = null;
  private scaleStart: TransformState | null = null;
  private activeModelId: string | null = null;
  private selected: { modelId: string; bone: number } | null = null;
  private dragging: {
    startLocal: BoneLocalTransform;
    proxyRot: Quaternion;
    proxyPos: Vector3;
    parentRot: Quaternion;
    meshScale: number;
  } | null = null;

  private constructor(private readonly canvas: HTMLCanvasElement) {}

  static async create(canvas: HTMLCanvasElement): Promise<BabylonStudioEngine> {
    const e = new BabylonStudioEngine(canvas);
    await e.init();
    return e;
  }

  // ---------------------------------------------------------------- init
  private async createEngine(): Promise<AbstractEngine> {
    const wantGpu = new URLSearchParams(location.search).has('webgpu');
    if (wantGpu && (await WebGPUEngine.IsSupportedAsync)) {
      try {
        const gpu = new WebGPUEngine(this.canvas, {
          antialias: true,
          stencil: true,
          premultipliedAlpha: false,
        });
        await gpu.initAsync();
        this.webgpu = true;
        return gpu;
      } catch (err) {
        this.events.emit('warning', `WebGPU unavailable, falling back to WebGL2 (${String(err)})`);
      }
    }
    const gl = new Engine(
      this.canvas,
      true,
      {
        preserveDrawingBuffer: false,
        stencil: true,
        alpha: true,
        premultipliedAlpha: false,
        powerPreference: 'high-performance',
      },
      true,
    );
    if (gl.webGLVersion < 2)
      this.events.emit('warning', 'WebGL2 is not available; some features may not work.');
    return gl;
  }

  private async init(): Promise<void> {
    this.engine = await this.createEngine();
    SdefInjector.OverrideEngineCreateEffect(this.engine);
    RegisterDxBmpTextureLoader();

    const scene = (this.scene = new Scene(this.engine));
    scene.ambientColor = new Color3(0.5, 0.5, 0.5);
    scene.clearColor = new Color4(0.1, 0.11, 0.14, 1);
    this.instrumentation = new SceneInstrumentation(scene);
    this.instrumentation.captureFrameTime = true;

    // cameras
    this.orbit = new ArcRotateCamera(
      'orbit',
      DEFAULT_CAMERA.alpha,
      DEFAULT_CAMERA.beta,
      DEFAULT_CAMERA.radius,
      new Vector3(...DEFAULT_CAMERA.target),
      scene,
    );
    this.orbit.minZ = 0.5;
    this.orbit.maxZ = 5000;
    this.orbit.wheelDeltaPercentage = 0.02;
    this.orbit.panningSensibility = 60;
    // Touch: natural pinch-to-zoom and two-finger pan.
    this.orbit.useNaturalPinchZoom = true;
    const pointers = this.orbit.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined;
    if (pointers) {
      pointers.multiTouchPanning = true;
      pointers.multiTouchPanAndZoom = true;
    }
    this.orbit.lowerRadiusLimit = 1;
    this.orbit.fov = DEFAULT_CAMERA.fov * DEG;
    this.fly = new UniversalCamera('fly', new Vector3(0, 12, -40), scene);
    this.fly.minZ = 0.5;
    this.fly.maxZ = 5000;
    this.fly.speed = 0.6;
    this.fly.keysUp = [87];
    this.fly.keysDown = [83];
    this.fly.keysLeft = [65];
    this.fly.keysRight = [68];
    this.fly.keysUpward = [69];
    this.fly.keysDownward = [81];
    this.mmdCamera = new MmdCamera('mmdCamera', new Vector3(0, 10, 0), scene, false);
    this.mmdCamera.maxZ = 5000;
    scene.activeCamera = this.orbit;
    this.orbit.attachControl(true);
    this.orbit.onViewMatrixChangedObservable.add(() => this.scheduleCameraEmit());

    // lights
    this.hemiLight = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    this.dirLight = new DirectionalLight('sun', new Vector3(0.5, -1, 1), scene);
    this.dirLight.autoUpdateExtends = true;
    this.dirLight.autoCalcShadowZBounds = true;

    // ground & helpers
    this.shadowGround = CreateGround('shadowGround', { width: 200, height: 200 }, scene);
    const som = new ShadowOnlyMaterial('shadowOnly', scene);
    som.activeLight = this.dirLight;
    som.alpha = 0.35;
    this.shadowGround.material = som;
    this.shadowGround.receiveShadows = true;
    this.shadowGround.isPickable = false;
    this.grid = CreateGround('grid', { width: 200, height: 200 }, scene);
    this.grid.position.y = 0.01;
    const gm = new GridMaterial('gridMat', scene);
    gm.majorUnitFrequency = 10;
    gm.gridRatio = 1;
    gm.mainColor = new Color3(0.1, 0.11, 0.14);
    gm.lineColor = new Color3(0.4, 0.45, 0.55);
    gm.opacity = 0.55;
    gm.backFaceCulling = false;
    this.grid.material = gm;
    this.grid.isPickable = false;

    this.pipeline = new DefaultRenderingPipeline('post', true, scene, [this.orbit, this.fly, this.mmdCamera]);

    // posing gizmos
    this.utilLayer = new UtilityLayerRenderer(scene);
    this.gizmoProxy = new TransformNode('gizmoProxy', scene);
    this.gizmoProxy.rotationQuaternion = Quaternion.Identity();
    // Touch: thicker handles (bigger pick area) and a larger on-screen size.
    const thickness = this.coarse ? 3 : 1;
    this.rotationGizmo = new RotationGizmo(this.utilLayer, 32, false, thickness);
    this.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = true;
    this.rotationGizmo.scaleRatio = this.coarse ? 1.5 : 0.9;
    this.positionGizmo = new PositionGizmo(this.utilLayer, thickness);
    this.positionGizmo.updateGizmoRotationToMatchAttachedMesh = false;
    this.positionGizmo.scaleRatio = this.coarse ? 1.5 : 1;
    for (const g of [this.rotationGizmo, this.positionGizmo]) {
      g.onDragStartObservable.add(() => this.onGizmoDragStart());
      g.onDragObservable.add(() => this.onGizmoDrag());
      g.onDragEndObservable.add(() => this.onGizmoDragEnd());
    }
    // Editor point gizmo (camera keys on the 3D path).
    this.pointNode = new TransformNode('pointGizmo', scene);
    this.pointGizmo = new PositionGizmo(this.utilLayer, thickness);
    this.pointGizmo.updateGizmoRotationToMatchAttachedMesh = false;
    this.pointGizmo.scaleRatio = this.coarse ? 1.4 : 0.9;
    const pointPos = (): [number, number, number] => [
      this.pointNode.position.x,
      this.pointNode.position.y,
      this.pointNode.position.z,
    ];
    this.pointGizmo.onDragObservable.add(() => this.pointCb?.onChange?.(pointPos()));
    this.pointGizmo.onDragEndObservable.add(() => this.pointCb?.onEnd?.(pointPos()));
    // Picture-in-picture: clear the inset before the VMD camera renders into it.
    scene.onBeforeCameraRenderObservable.add((cam) => {
      if (!this.pip || cam !== this.mmdCamera || !scene.activeCameras?.length) return;
      const w = this.engine.getRenderWidth();
      const h = this.engine.getRenderHeight();
      const v = this.mmdCamera.viewport;
      this.engine.enableScissor(v.x * w, v.y * h, v.width * w, v.height * h);
      this.engine.clear(scene.clearColor, true, true, true);
      this.engine.disableScissor();
    });
    // Uniform scale gizmo for the active model (on-screen "scale" mode).
    this.scaleGizmo = new ScaleGizmo(this.utilLayer, thickness);
    this.scaleGizmo.scaleRatio = this.coarse ? 1.6 : 1.1;
    this.scaleGizmo.xGizmo.isEnabled = false;
    this.scaleGizmo.yGizmo.isEnabled = false;
    this.scaleGizmo.zGizmo.isEnabled = false;
    this.scaleGizmo.uniformScaleGizmo.sensitivity = 3;
    this.scaleGizmo.onDragStartObservable.add(() => {
      const m = this.activeModelId ? this.models.get(this.activeModelId) : undefined;
      this.scaleStart = m ? structuredClone(m.transform) : null;
    });
    this.scaleGizmo.onDragEndObservable.add(() => {
      const m = this.activeModelId ? this.models.get(this.activeModelId) : undefined;
      if (!m || !this.scaleStart) return;
      const scale = Math.max(0.01, Math.round(m.mesh.scaling.x * 1000) / 1000);
      const after = { ...m.transform, scale };
      this.setModelTransform(m.id, after);
      this.events.emit('modelTransformEdited', { modelId: m.id, before: this.scaleStart, after });
      this.scaleStart = null;
    });
    this.moveGizmo = new PositionGizmo(this.utilLayer, thickness);
    this.moveGizmo.scaleRatio = this.coarse ? 1.6 : 1.1;
    this.moveGizmo.updateGizmoRotationToMatchAttachedMesh = false;
    this.moveGizmo.planarGizmoEnabled = true;
    // Only the floor plane (normal +Y); the vertical planes are easy to grab by mistake.
    this.moveGizmo.xPlaneGizmo.isEnabled = false;
    this.moveGizmo.zPlaneGizmo.isEnabled = false;
    this.moveGizmo.onDragStartObservable.add(() => {
      const m = this.activeModelId ? this.models.get(this.activeModelId) : undefined;
      this.moveStart = m ? structuredClone(m.transform) : null;
    });
    this.moveGizmo.onDragEndObservable.add(() => {
      const m = this.activeModelId ? this.models.get(this.activeModelId) : undefined;
      if (!m || !this.moveStart) return;
      const r = (v: number): number => Math.round(v * 100) / 100;
      const p = m.mesh.position;
      const after = { ...m.transform, position: [r(p.x), r(p.y), r(p.z)] as TransformState['position'] };
      this.setModelTransform(m.id, after);
      this.events.emit('modelTransformEdited', { modelId: m.id, before: this.moveStart, after });
      this.moveStart = null;
    });

    // MMD runtime + physics
    await this.initPhysics();
    const runtime = (this.runtime = new MmdRuntime(
      scene,
      this.physicsRuntime ? new MmdBulletPhysics(this.physicsRuntime) : null,
    ));
    runtime.loggingEnabled = false;
    runtime.register(scene);
    runtime.addAnimatable(this.mmdCamera);
    runtime.onPauseAnimationObservable.add(() => this.onRuntimePaused());
    runtime.onPlayAnimationObservable.add(() => this.emitPlayback(true));
    runtime.onSeekAnimationObservable.add(() => this.emitPlayback(true));
    runtime.onAnimationDurationChangedObservable.add(() => this.emitPlayback(true));
    this.vmdLoader = new VmdLoader(scene);
    this.vmdLoader.loggingEnabled = false;

    scene.onBeforeRenderObservable.add(() => this.beforeRender());
    this.text = new TextLayer({
      scene,
      shadowGen: () => this.shadowGen ?? null,
      frame: () => this.runtime.currentFrameTime,
      bone: (modelId, bone) => this.boneWorldPosition(modelId, bone),
      scaling: () => this.engine.getHardwareScalingLevel(),
    });
    this.engine.onContextLostObservable.add(() => this.events.emit('contextLost', undefined));
    this.engine.onContextRestoredObservable.add(() => this.events.emit('contextRestored', undefined));
    this.applySettings(this.settings);

    this.resizeObserver = new ResizeObserver(() => {
      // Skip while capturing or while the canvas is detached/being re-parented (0×0).
      if (!this.capturing && this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0)
        this.engine.resize();
    });
    this.resizeObserver.observe(this.canvas);
    this.engine.runRenderLoop(() => {
      if (this.capturing || !this.canvas.isConnected || this.canvas.clientWidth === 0) return;
      // UI can pause rendering (e.g. a full-height sheet hides the viewport) unless playback needs it.
      if (this.renderPaused && !this.runtime.isAnimationPlaying) return;
      scene.render();
    });
  }

  private async initPhysics(): Promise<void> {
    try {
      const wasm = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
      const pr = new MultiPhysicsRuntime(wasm);
      pr.setGravity(new Vector3(0, -this.settings.physics.gravity, 0));
      pr.register(this.scene);
      this.physicsRuntime = pr;
      this.physicsAvailable = true;
      this.events.emit('physicsStatus', { available: true });
    } catch (err) {
      this.physicsRuntime = null;
      this.physicsAvailable = false;
      const message = `Physics engine failed to initialise (${err instanceof Error ? err.message : String(err)}). Models will load without physics.`;
      this.events.emit('physicsStatus', { available: false, message });
      this.events.emit('warning', message);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    for (const id of [...this.models.keys()]) this.removeModel(id);
    this.text?.dispose();
    this.audio.dispose();
    this.engine.stopRenderLoop();
    this.runtime.dispose(this.scene);
    this.physicsRuntime?.dispose();
    this.utilLayer.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.events.clear();
  }

  // ---------------------------------------------------------------- frame
  private beforeRender(): void {
    const now = performance.now();
    const playing = this.runtime.isAnimationPlaying;
    // Audio leads; the animation follows by nudging its speed (applies from the next frame).
    const nudge = this.audio.sync(this.runtime.currentTime, playing, this.speed);
    const scale = this.capturing ? this.speed : this.speed * nudge;
    if (this.runtime.timeScale !== scale) this.runtime.timeScale = scale;

    for (const m of this.models.values()) {
      if (!m.physics || !this.settings.physics.enabled) m.model.rigidBodyStates.fill(0);
    }

    if (this.follow) {
      const pos = this.boneWorldPosition(this.follow.modelId, this.follow.bone);
      if (pos) Vector3.LerpToRef(this.orbit.target, pos, 0.2, this.orbit.target);
    }
    if (this.selected && !this.dragging) this.syncProxyToBone();

    // Live clocks read getPlayback() per frame; the store only needs coarse updates while playing.
    if (playing && now - this.lastPlaybackEmit > 250) this.emitPlayback();
    if (this.settings.viewport.showStats && now - this.lastStats > 500) {
      this.lastStats = now;
      this.events.emit('stats', {
        fps: Math.round(this.engine.getFps()),
        drawCalls: this.instrumentation.drawCallsCounter.current,
        activeMeshes: this.scene.getActiveMeshes().length,
        frameTimeMs: Math.round(this.instrumentation.frameTimeCounter.lastSecAverage * 10) / 10,
      });
    }
  }

  private emitPlayback(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastPlaybackEmit < 30) return;
    this.lastPlaybackEmit = now;
    this.events.emit('playback', this.getPlayback());
  }

  private onRuntimePaused(): void {
    const dur = this.runtime.animationFrameTimeDuration;
    if (this.loop && dur > 0 && this.runtime.currentFrameTime >= dur - 0.01 && !this.capturing) {
      void this.runtime.seekAnimation(0, true).then(() => this.runtime.playAnimation());
    }
    this.emitPlayback(true);
  }

  getPlayback(): PlaybackState {
    return {
      playing: this.runtime.isAnimationPlaying,
      frame: this.runtime.currentFrameTime,
      duration: this.runtime.animationFrameTimeDuration,
      speed: this.speed,
      loop: this.loop,
    };
  }

  // ---------------------------------------------------------------- settings
  applySettings(s: SceneSettings): void {
    const prev = this.settings;
    this.settings = structuredClone(s);
    const scene = this.scene;

    // viewport
    if (this.appliedQuality !== s.viewport.quality) this.applyQuality(s.viewport.quality);
    this.grid.setEnabled(s.viewport.showGrid && !this.hasVisibleStage());
    if (s.viewport.showAxes && !this.axes) this.axes = new AxesViewer(scene, 3);
    if (!s.viewport.showAxes && this.axes) {
      this.axes.dispose();
      this.axes = null;
    }

    // lighting
    const l = s.lighting;
    const az = l.dirAzimuth * DEG;
    const el = Math.max(5, l.dirElevation) * DEG;
    const dir = new Vector3(
      -Math.sin(az) * Math.cos(el),
      -Math.sin(el),
      Math.cos(az) * Math.cos(el),
    ).normalize();
    this.dirLight.direction = dir;
    this.dirLight.position = dir.scale(-80);
    this.dirLight.intensity = l.dirIntensity;
    this.dirLight.diffuse = hexColor(l.dirColor);
    this.dirLight.specular = hexColor(l.dirColor).scale(0.3);
    this.hemiLight.intensity = l.ambientIntensity;
    this.hemiLight.diffuse = hexColor(l.ambientColor);
    this.hemiLight.groundColor = hexColor(l.groundColor);
    this.shadowGen.setDarkness(l.shadowDarkness);
    this.shadowGen.usePercentageCloserFiltering = l.softShadows;
    this.shadowGen.filteringQuality = l.softShadows
      ? ShadowGenerator.QUALITY_HIGH
      : ShadowGenerator.QUALITY_LOW;
    this.dirLight.shadowEnabled = l.shadows;
    (this.shadowGround.material as ShadowOnlyMaterial).alpha = 1 - l.shadowDarkness;
    this.shadowGround.setEnabled(l.shadows && s.background.showGround && !this.hasVisibleStage());

    // background
    this.applyBackground(s, prev);

    // post fx
    const p = s.postfx;
    const pl = this.pipeline;
    pl.bloomEnabled = p.bloom;
    pl.bloomWeight = p.bloomWeight;
    pl.bloomThreshold = p.bloomThreshold;
    pl.bloomKernel = 64;
    pl.depthOfFieldEnabled = p.dof;
    if (p.dof) {
      pl.depthOfField.focusDistance = p.dofFocusDistance * 1000;
      pl.depthOfField.fStop = p.dofFStop;
      pl.depthOfField.focalLength = 50;
      pl.depthOfField.lensSize = 50;
    }
    pl.fxaaEnabled = p.fxaa;
    pl.imageProcessingEnabled = true;
    const ip = pl.imageProcessing;
    ip.toneMappingEnabled = p.toneMapping !== 'none';
    ip.toneMappingType =
      p.toneMapping === 'aces'
        ? ImageProcessingConfiguration.TONEMAPPING_ACES
        : p.toneMapping === 'khr'
          ? ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL
          : ImageProcessingConfiguration.TONEMAPPING_STANDARD;
    ip.exposure = p.exposure;
    ip.contrast = p.contrast;
    ip.vignetteEnabled = p.vignette;
    ip.vignetteWeight = p.vignetteWeight;
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    this.setSsao(p.ssao);
    if (prev.postfx.outlineScale !== p.outlineScale)
      for (const m of this.models.values()) this.applyMaterials(m);

    // physics
    if (this.physicsRuntime) {
      this.physicsRuntime.setGravity(new Vector3(0, -s.physics.gravity, 0));
      this.physicsRuntime.maxSubSteps = Math.max(1, Math.round(s.physics.substeps));
      this.physicsRuntime.fixedTimeStep = s.physics.fixedTimeStep;
    }
  }

  private applyQuality(q: QualityPreset): void {
    this.appliedQuality = q;
    const dpr = window.devicePixelRatio || 1;
    if (this.coarse) {
      // Phones/tablets: cap pixel ratio at 2 (1.5 on Low) and rely on FXAA instead of MSAA on Low.
      this.engine.setHardwareScalingLevel(1 / Math.min(dpr, q === 'low' ? 1.5 : 2));
      this.pipeline.samples = q === 'low' ? 1 : q === 'medium' ? 2 : 4;
    } else {
      this.engine.setHardwareScalingLevel(
        q === 'low' ? 1.5 : q === 'medium' ? 1 / Math.min(dpr, 1.5) : 1 / dpr,
      );
      this.pipeline.samples = q === 'low' ? 1 : q === 'medium' ? 4 : 8;
    }
    const size = q === 'low' ? 1024 : q === 'medium' ? 2048 : this.coarse ? 2048 : 4096;
    const casters = this.shadowGen?.getShadowMap()?.renderList?.slice() ?? [];
    this.shadowGen?.dispose();
    this.shadowGen = new ShadowGenerator(size, this.dirLight);
    this.shadowGen.bias = 0.0005;
    this.shadowGen.normalBias = 0.02;
    this.shadowGen.forceBackFacesOnly = true;
    this.shadowGen.transparencyShadow = true;
    for (const c of casters) this.shadowGen.addShadowCaster(c, false);
    if (this.settings) {
      this.shadowGen.setDarkness(this.settings.lighting.shadowDarkness);
      this.shadowGen.usePercentageCloserFiltering = this.settings.lighting.softShadows;
    }
  }

  private setSsao(enabled: boolean): void {
    if (enabled && !this.ssao) {
      if (!SSAO2RenderingPipeline.IsSupported) {
        this.events.emit('warning', 'SSAO is not supported on this device.');
        return;
      }
      this.ssao = new SSAO2RenderingPipeline('ssao', this.scene, { ssaoRatio: 0.5, blurRatio: 1 }, [
        this.orbit,
        this.fly,
        this.mmdCamera,
      ]);
      this.ssao.radius = 2;
      this.ssao.totalStrength = 1.2;
      this.ssao.samples = 16;
      this.ssao.maxZ = 250;
    } else if (!enabled && this.ssao) {
      this.ssao.dispose();
      this.ssao = null;
    }
  }

  private applyBackground(s: SceneSettings, prev: SceneSettings): void {
    const b = s.background;
    const scene = this.scene;
    const c = hexColor(b.color);
    scene.clearColor = b.mode === 'transparent' ? new Color4(0, 0, 0, 0) : new Color4(c.r, c.g, c.b, 1);
    if (b.mode === 'gradient') {
      if (!this.bgLayer) {
        this.bgTexture = new DynamicTexture('bgGradient', { width: 4, height: 256 }, scene, false);
        this.bgLayer = new Layer('bg', null, scene, true);
        this.bgLayer.texture = this.bgTexture;
      }
      if (
        !this.bgLayer.isEnabled ||
        prev.background.gradientTop !== b.gradientTop ||
        prev.background.gradientBottom !== b.gradientBottom ||
        prev === this.settings
      ) {
        const ctx = this.bgTexture!.getContext();
        const g = ctx.createLinearGradient(0, 0, 0, 256);
        g.addColorStop(0, b.gradientTop);
        g.addColorStop(1, b.gradientBottom);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 4, 256);
        this.bgTexture!.update(false);
      }
      this.bgLayer.isEnabled = true;
    } else if (this.bgLayer) {
      this.bgLayer.isEnabled = false;
    }
    const showHdr = b.mode === 'hdr' && this.hdrTexture !== null;
    if (this.skybox) this.skybox.setEnabled(showHdr);
    if (this.hdrTexture) this.hdrTexture.level = b.hdrIntensity;
    scene.environmentIntensity = b.hdrIntensity;
  }

  async setHdrEnvironment(file: VFile | null): Promise<void> {
    this.skybox?.dispose(false, true);
    this.skybox = null;
    this.hdrTexture?.dispose();
    this.hdrTexture = null;
    this.scene.environmentTexture = null;
    if (!file) return;
    const url = URL.createObjectURL(file.blob);
    const isEnv = file.path.toLowerCase().endsWith('.env');
    let tex: BaseTexture;
    try {
      tex = await new Promise<BaseTexture>((resolve, reject) => {
        const fail = (message?: string, exception?: unknown): void => {
          const detail =
            exception instanceof Error ? exception.message : typeof exception === 'string' ? exception : '';
          reject(new Error(message || detail || 'Environment texture failed to load'));
        };
        const timer = setTimeout(() => fail('Timed out loading environment texture'), 60_000);
        const done = (t: BaseTexture): void => {
          clearTimeout(timer);
          resolve(t);
        };
        // onLoad may fire synchronously from the constructor, so defer reading the instance.
        let created: BaseTexture | null = null;
        const onLoad = (): void => void setTimeout(() => created && done(created));
        created = isEnv
          ? new CubeTexture(
              url,
              this.scene,
              null,
              false,
              null,
              onLoad,
              (m, e) => fail(m, e),
              undefined,
              true,
              '.env',
            )
          : new HDRCubeTexture(url, this.scene, 256, false, true, false, true, onLoad, (m, e) => fail(m, e));
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    this.hdrTexture = tex;
    this.scene.environmentTexture = tex;
    this.skybox = this.scene.createDefaultSkybox(tex, false, 1500, 0) ?? null;
    this.applyBackground(this.settings, this.settings);
  }

  // ---------------------------------------------------------------- models
  async loadModel(files: VFile[], mainPath: string, options: LoadModelOptions = {}): Promise<ModelInfo> {
    const id = options.id ?? newId();
    const fileName = basename(mainPath);
    const progressId = `model-${id}`;
    this.events.emit('progress', { id: progressId, label: `Loading ${fileName}`, progress: 0, done: false });
    try {
      const prepared = await prepareModelFiles(files, mainPath, {
        maxTextureSize: textureCap(this.settings.viewport.quality, this.coarse),
      });
      const container = await LoadAssetContainerAsync(prepared.main, this.scene, {
        rootUrl: prepared.rootUrl,
        pluginOptions: {
          // Serialization data keeps the PMX's English material names (display labels).
          mmdmodel: { referenceFiles: prepared.referenceFiles, loggingEnabled: false, preserveSerializationData: true },
        },
        onProgress: (ev) => {
          if (ev.lengthComputable && ev.total > 0) {
            this.events.emit('progress', {
              id: progressId,
              label: `Loading ${fileName}`,
              progress: ev.loaded / ev.total,
              done: false,
            });
          }
        },
      });
      container.addAllToScene();
      const mesh = container.meshes[0] as MmdMesh;
      const metadata = mesh.metadata as MmdModelMetadata;
      const model = this.runtime.createMmdModel(mesh, {
        materialProxyConstructor: MmdStandardMaterialProxy,
        buildPhysics: this.physicsRuntime ? { disableOffsetForConstraintFrame: true } : false,
      });
      for (const m of container.meshes) {
        if (m.getTotalVertices() > 0) {
          this.shadowGen.addShadowCaster(m, false);
          m.receiveShadows = true;
        }
      }
      const materials = metadata.materials;
      const baseOutline = materials.map((mat) => (mat instanceof MmdStandardMaterial ? mat.outlineWidth : 0));
      const name = options.name ?? (metadata.header.modelName || stripExt(fileName));
      const boneIndex = new Map(model.runtimeBones.map((b, i) => [b, i]));
      const boneEn = new Map(metadata.bones.map((b) => [b.name, b.englishName]));
      const matMeta = (metadata as { materialsMetadata?: { englishName?: string }[] }).materialsMetadata;
      const bones: BoneInfo[] = model.runtimeBones.map((b, i) => ({
        index: i,
        name: b.name,
        en: boneEn.get(b.name) || undefined,
        parent: b.parentBone ? (boneIndex.get(b.parentBone) ?? -1) : -1,
        physics:
          b.rigidBodyIndices.length > 0 &&
          metadata.rigidBodies.some((rb, ri) => b.rigidBodyIndices.includes(ri) && rb.physicsMode !== 0),
      }));
      const morphs: MorphInfo[] = metadata.morphs.map((m, i) => ({
        index: i,
        name: m.name,
        en: m.englishName || undefined,
        category: CATEGORY[m.category] ?? 'other',
      }));
      const matInfos: MaterialInfo[] = materials.map((mat, i) => ({
        index: i,
        name: mat.name,
        en: matMeta?.[i]?.englishName || undefined,
        visible: true,
        outline: mat instanceof MmdStandardMaterial ? mat.renderOutline : false,
        alpha: mat.alpha,
      }));
      const info: ModelInfo = {
        id,
        name,
        fileName,
        morphs,
        bones,
        materials: matInfos,
        rigidBodyCount: metadata.rigidBodies.length,
        missingTextures: prepared.missing,
        vertexCount: container.meshes.reduce((a, m) => a + m.getTotalVertices(), 0),
      };
      const entry: ModelEntry = {
        id,
        name,
        container,
        mesh,
        model,
        info,
        physics: true,
        visible: true,
        stage: false,
        motion: null,
        baseOutline,
        materialState: matInfos.map((m) => ({ visible: true, outline: m.outline, alpha: m.alpha })),
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
        restPositions: model.runtimeBones.map((b) => b.linkedBone.position.clone()),
        ikEnabled: true,
        ikChains: metadata.bones.flatMap((b, i) =>
          b.ik ? [{ bone: i, target: b.ik.target, links: b.ik.links.map((l) => l.target) }] : [],
        ),
      };
      this.models.set(id, entry);
      if (prepared.missing.length) {
        this.events.emit(
          'warning',
          `${name}: ${prepared.missing.length} texture(s) missing — ${prepared.missing.slice(0, 4).join(', ')}${prepared.missing.length > 4 ? '…' : ''}`,
        );
      }
      if (prepared.remapped.length) {
        this.events.emit(
          'warning',
          `${name}: ${prepared.remapped.length} texture path(s) resolved by filename only.`,
        );
      }
      if (options.state) this.applyModelState(entry, options.state);
      this.applyMaterials(entry);
      this.events.emit('modelAdded', info);
      return info;
    } finally {
      this.events.emit('progress', { id: progressId, label: `Loaded ${fileName}`, progress: 1, done: true });
    }
  }

  private applyModelState(entry: ModelEntry, state: Partial<ModelRuntimeState>): void {
    if (state.transform) this.setModelTransform(entry.id, state.transform);
    if (state.visible !== undefined) this.setModelVisible(entry.id, state.visible);
    if (state.physics !== undefined) entry.physics = state.physics;
    if (state.stage) this.setModelStage(entry.id, true);
    if (state.materials) {
      state.materials.forEach((m, i) => {
        if (entry.materialState[i]) entry.materialState[i] = { ...entry.materialState[i], ...m };
      });
    }
    if (state.morphs)
      for (const [k, v] of Object.entries(state.morphs)) entry.model.morph.setMorphWeight(k, v);
  }

  removeModel(id: string): void {
    const m = this.models.get(id);
    if (!m) return;
    if (this.selected?.modelId === id) this.selectBone(null, null);
    if (this.follow?.modelId === id) this.follow = null;
    if (this.activeModelId === id) this.setActiveModel(null);
    if (m.motion) m.model.destroyRuntimeAnimation(m.motion.handle);
    for (const mesh of m.container.meshes) this.shadowGen.removeShadowCaster(mesh, false);
    this.runtime.destroyMmdModel(m.model);
    m.container.removeAllFromScene();
    m.container.dispose();
    this.models.delete(id);
    this.updateDuration();
    this.refreshStageEnvironment();
    this.events.emit('modelRemoved', id);
  }

  listModels(): string[] {
    return [...this.models.keys()];
  }

  private need(id: string): ModelEntry {
    const m = this.models.get(id);
    if (!m) throw new Error(`Unknown model ${id}`);
    return m;
  }

  setModelVisible(id: string, visible: boolean): void {
    const m = this.models.get(id);
    if (!m) return;
    m.visible = visible;
    m.mesh.setEnabled(visible);
    if (m.stage) this.refreshStageEnvironment();
  }

  setModelStage(id: string, stage: boolean): void {
    const m = this.models.get(id);
    if (!m) return;
    m.stage = stage;
    for (const mesh of m.container.meshes) {
      mesh.isPickable = !stage;
      // A huge stage as shadow caster stretches the shadow map and blurs the dancers' shadows.
      if (mesh.getTotalVertices() === 0) continue;
      if (stage) this.shadowGen.removeShadowCaster(mesh, false);
      else this.shadowGen.addShadowCaster(mesh, false);
    }
    if (stage && this.activeModelId === id) this.setActiveModel(null);
    if (stage && this.selected?.modelId === id) this.selectBone(null, null);
    this.refreshStageEnvironment();
  }

  private hasVisibleStage(): boolean {
    return [...this.models.values()].some((m) => m.stage && m.visible);
  }

  /** A visible stage brings its own floor: hide the grid and the shadow-catcher ground. */
  private refreshStageEnvironment(): void {
    const s = this.settings;
    const hasStage = this.hasVisibleStage();
    this.grid.setEnabled(s.viewport.showGrid && !hasStage);
    this.shadowGround.setEnabled(s.lighting.shadows && s.background.showGround && !hasStage);
  }

  setModelPhysics(id: string, enabled: boolean): void {
    const m = this.models.get(id);
    if (!m) return;
    m.physics = enabled;
    if (enabled && this.settings.physics.enabled) {
      m.model.rigidBodyStates.fill(1);
      this.runtime.initializeMmdModelPhysics(m.model);
    } else {
      // 0 = rigid bodies follow their bones (kinematic) instead of being simulated.
      m.model.rigidBodyStates.fill(0);
    }
  }

  setModelTransform(id: string, t: TransformState): void {
    const m = this.models.get(id);
    if (!m) return;
    m.transform = structuredClone(t);
    m.mesh.position.set(...t.position);
    m.mesh.rotationQuaternion = Quaternion.FromEulerAngles(
      t.rotation[0] * DEG,
      t.rotation[1] * DEG,
      t.rotation[2] * DEG,
    );
    m.mesh.scaling.setAll(Math.max(0.01, t.scale));
    if (m.physics && this.settings.physics.enabled) this.runtime.initializeMmdModelPhysics(m.model);
  }

  setMaterialState(
    id: string,
    index: number,
    state: { visible?: boolean; outline?: boolean; alpha?: number },
  ): void {
    const m = this.models.get(id);
    if (!m || !m.materialState[index]) return;
    m.materialState[index] = { ...m.materialState[index], ...state };
    this.applyMaterials(m);
  }

  private applyMaterials(m: ModelEntry): void {
    const metadata = m.mesh.metadata as MmdModelMetadata;
    metadata.materials.forEach((mat, i) => {
      const st = m.materialState[i];
      if (!st) return;
      const meshes = metadata.meshes.filter((mesh) => mesh.material === mat);
      if (meshes.length) for (const mesh of meshes) mesh.isVisible = st.visible;
      mat.alpha = st.visible || meshes.length ? st.alpha : 0;
      if (mat instanceof MmdStandardMaterial) {
        mat.renderOutline = st.outline && this.settings.postfx.outlineScale > 0;
        mat.outlineWidth = m.baseOutline[i] * this.settings.postfx.outlineScale;
      }
    });
  }

  setMorph(id: string, name: string, weight: number): void {
    this.models.get(id)?.model.morph.setMorphWeight(name, weight);
  }

  getMorphWeights(id: string): Record<string, number> {
    const m = this.models.get(id);
    if (!m) return {};
    const out: Record<string, number> = {};
    for (const morph of m.info.morphs) out[morph.name] = m.model.morph.getMorphWeight(morph.name);
    return out;
  }

  resetMorphs(id: string): void {
    this.models.get(id)?.model.morph.resetMorphWeights();
  }

  getBoneWorldPositions(id: string): Record<string, [number, number, number]> | null {
    const m = this.models.get(id);
    if (!m) return null;
    const world = m.mesh.computeWorldMatrix(true);
    const tmp = new Vector3();
    const out: Record<string, [number, number, number]> = {};
    for (const b of m.model.runtimeBones) {
      b.getWorldTranslationToRef(tmp);
      Vector3.TransformCoordinatesToRef(tmp, world, tmp);
      out[b.name] = [tmp.x, tmp.y, tmp.z];
    }
    return out;
  }

  getSkeleton(
    id: string,
  ): { name: string; bones: { name: string; parent: number; position: [number, number, number] }[] } | null {
    const m = this.models.get(id);
    if (!m) return null;
    // MMD bones carry no rest rotation: model-space rest position = sum of local rest offsets.
    const abs: [number, number, number][] = [];
    const bones = m.info.bones.map((b) => ({
      name: b.name,
      parent: b.parent,
      position: [0, 0, 0] as [number, number, number],
    }));
    const resolve = (i: number, depth = 0): [number, number, number] => {
      if (abs[i]) return abs[i];
      const r = m.restPositions[i];
      const p = bones[i].parent;
      const base = p >= 0 && depth < 512 ? resolve(p, depth + 1) : ([0, 0, 0] as [number, number, number]);
      abs[i] = [base[0] + r.x, base[1] + r.y, base[2] + r.z];
      return abs[i];
    };
    bones.forEach((b, i) => (b.position = resolve(i)));
    return { name: m.name, bones };
  }

  getModelState(id: string): ModelRuntimeState | null {
    const m = this.models.get(id);
    if (!m) return null;
    return {
      visible: m.visible,
      physics: m.physics,
      stage: m.stage,
      transform: structuredClone(m.transform),
      materials: structuredClone(m.materialState),
      morphs: Object.fromEntries(Object.entries(this.getMorphWeights(id)).filter(([, v]) => v !== 0)),
    };
  }

  // ---------------------------------------------------------------- motion & media
  private motionInfo(animation: MmdAnimation, name: string): MotionInfo {
    const groups: MotionInfo['groups'] = [];
    for (const t of [...animation.boneTracks, ...animation.movableBoneTracks]) {
      if (t.frameNumbers.length > 1 || (t.frameNumbers.length === 1 && t.frameNumbers[0] > 0)) {
        groups.push({ name: t.name, kind: 'bone', frames: Array.from(t.frameNumbers) });
      }
    }
    for (const t of animation.morphTracks) {
      if (t.frameNumbers.length > 0)
        groups.push({ name: t.name, kind: 'morph', frames: Array.from(t.frameNumbers) });
    }
    return { name, frameCount: animation.endFrame, groups };
  }

  async loadMotion(modelId: string, file: VFile | null): Promise<MotionInfo | null> {
    const m = this.need(modelId);
    if (m.motion) {
      m.model.setRuntimeAnimation(null);
      m.model.destroyRuntimeAnimation(m.motion.handle);
      m.motion = null;
    }
    if (!file) {
      this.updateDuration();
      this.events.emit('motionChanged', { modelId, motion: null });
      return null;
    }
    const buffer = await file.blob.arrayBuffer();
    const animation = await this.vmdLoader.loadFromBufferAsync(basename(file.path), buffer);
    const handle = m.model.createRuntimeAnimation(animation);
    m.model.setRuntimeAnimation(handle);
    m.motion = { animation, handle };
    this.updateDuration();
    await this.runtime.seekAnimation(this.runtime.currentFrameTime, true);
    const info = this.motionInfo(animation, basename(file.path));
    this.events.emit('motionChanged', { modelId, motion: info });
    return info;
  }

  // ---------------------------------------------------------------- motion editing
  /** Replace a model's runtime animation with an edited clip (no reload; unchanged tracks reused). */
  setMotionClip(modelId: string, clip: MotionClip | null, name = 'edited.vmd'): MotionInfo | null {
    const m = this.need(modelId);
    const old = m.motion;
    if (!clip) {
      if (old) {
        m.model.setRuntimeAnimation(null);
        m.model.destroyRuntimeAnimation(old.handle);
        m.motion = null;
      }
      this.updateDuration();
      this.events.emit('motionChanged', { modelId, motion: null });
      return null;
    }
    const animation = buildMmdAnimation(name, clip, 'model');
    const handle = m.model.createRuntimeAnimation(animation);
    m.model.setRuntimeAnimation(handle);
    if (old) m.model.destroyRuntimeAnimation(old.handle);
    m.motion = { animation, handle };
    if (!m.ikEnabled) m.model.ikSolverStates.fill(0);
    this.updateDuration();
    this.refreshPose();
    const info = this.motionInfo(animation, name);
    this.events.emit('motionChanged', { modelId, motion: info });
    return info;
  }

  /** Replace the camera's runtime animation with an edited clip. */
  setCameraClip(clip: MotionClip | null, name = 'camera.vmd'): CameraMotionInfo | null {
    const old = this.cameraMotion;
    if (!clip || !clip.camera.length) {
      void this.loadCameraMotion(null);
      return null;
    }
    const animation = buildMmdAnimation(name, clip, 'camera');
    const handle = this.mmdCamera.createRuntimeAnimation(animation);
    this.mmdCamera.setRuntimeAnimation(handle);
    if (old) this.mmdCamera.destroyRuntimeAnimation(old.handle);
    this.cameraMotion = { animation, handle };
    this.updateDuration();
    this.applyPip();
    this.refreshPose();
    const info: CameraMotionInfo = {
      name,
      frameCount: animation.endFrame,
      frames: Array.from(animation.cameraTrack.frameNumbers),
    };
    this.events.emit('cameraMotionChanged', info);
    return info;
  }

  private refreshQueued = false;
  /** Re-evaluate the current frame (paused only; playback picks edits up on its own). */
  private refreshPose(): void {
    if (this.runtime.isAnimationPlaying || this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      void this.runtime.seekAnimation(this.runtime.currentFrameTime, true);
    });
  }

  /** Current local key values (VMD position offset + rotation) of bones, including unkeyed manual edits. */
  getBoneKeyValues(
    modelId: string,
    names?: string[],
  ): Record<string, { p: [number, number, number]; r: [number, number, number, number] }> {
    const m = this.models.get(modelId);
    const out: Record<string, { p: [number, number, number]; r: [number, number, number, number] }> = {};
    if (!m) return out;
    const want = names ? new Set(names) : null;
    m.model.runtimeBones.forEach((b, i) => {
      if (want && !want.has(b.name)) return;
      const q = b.linkedBone.rotationQuaternion;
      const p = b.linkedBone.position.subtract(m.restPositions[i]);
      out[b.name] = { p: [p.x, p.y, p.z], r: [q.x, q.y, q.z, q.w] };
    });
    return out;
  }

  /**
   * Local rotations as actually rendered (after IK and append transforms), derived from world matrices:
   * MMD bones have no rest rotation, so local = parentWorld⁻¹ · world.
   */
  getSolvedLocalRotations(
    modelId: string,
    names: string[],
  ): Record<string, [number, number, number, number]> {
    const m = this.models.get(modelId);
    const out: Record<string, [number, number, number, number]> = {};
    if (!m) return out;
    const index = new Map(m.model.runtimeBones.map((b, i) => [b.name, i]));
    const worldRot = (i: number): Matrix => {
      const q = new Quaternion();
      m.model.runtimeBones[i].getWorldMatrixToRef(new Matrix()).decompose(undefined, q, undefined);
      return Matrix.FromQuaternionToRef(q, new Matrix());
    };
    for (const name of names) {
      const i = index.get(name);
      if (i === undefined) continue;
      const parent = m.model.runtimeBones[i].parentBone;
      const w = worldRot(i);
      // Row-vector convention: W = L · P  ⇒  L = W · P⁻¹.
      const lm = parent ? w.multiply(Matrix.Invert(worldRot(m.model.runtimeBones.indexOf(parent)))) : w;
      const l = Quaternion.FromRotationMatrix(lm).normalize();
      out[name] = [l.x, l.y, l.z, l.w];
    }
    return out;
  }

  /** Model-space positions of bones as rendered (for IK fitting, pins and overlays). */
  getBoneModelPositions(modelId: string, names: string[]): Record<string, [number, number, number]> {
    const m = this.models.get(modelId);
    const out: Record<string, [number, number, number]> = {};
    if (!m) return out;
    const tmp = new Vector3();
    for (const b of m.model.runtimeBones) {
      if (!names.includes(b.name)) continue;
      b.getWorldTranslationToRef(tmp);
      out[b.name] = [tmp.x, tmp.y, tmp.z];
    }
    return out;
  }

  /**
   * Evaluate the model at given frames (animation + IK + append transforms, no physics) and read
   * solved local rotations and model-space positions. Restores the current frame afterwards.
   */
  sampleModel(
    modelId: string,
    frames: number[],
    names: string[],
    opts: { ik?: boolean; world?: boolean } = {},
  ): {
    r: Record<string, [number, number, number, number]>;
    pos: Record<string, [number, number, number]>;
  }[] {
    const m = this.models.get(modelId);
    if (!m) return [];
    const world = opts.world ? m.mesh.computeWorldMatrix(true) : null;
    const tmp = new Vector3();
    const states = m.model.ikSolverStates.slice();
    const out: ReturnType<StudioEngine['sampleModel']> = [];
    const model = m.model as MmdModel & { beforePhysics(frame: number | null): void; afterPhysics(): void };
    const before = m.rawBeforePhysics ?? model.beforePhysics.bind(model);
    const ik = opts.ik ?? m.ikEnabled;
    for (const f of frames) {
      before(f);
      if (!ik) {
        // Animation (property track) re-enables solvers; recompute the pose without them.
        m.model.ikSolverStates.fill(0);
        before(null);
      }
      model.afterPhysics();
      const pos = this.getBoneModelPositions(modelId, names);
      if (world) {
        for (const k of Object.keys(pos)) {
          Vector3.TransformCoordinatesToRef(tmp.set(...pos[k]), world, tmp);
          pos[k] = [tmp.x, tmp.y, tmp.z];
        }
      }
      out.push({ r: this.getSolvedLocalRotations(modelId, names), pos });
    }
    m.model.ikSolverStates.set(states);
    void this.runtime.seekAnimation(this.runtime.currentFrameTime, true);
    return out;
  }

  /** IK chains (bone names) of a model. */
  getIkChains(modelId: string): { bone: string; target: string; links: string[] }[] {
    const m = this.models.get(modelId);
    if (!m) return [];
    const name = (i: number): string => m.model.runtimeBones[i]?.name ?? '';
    return m.ikChains.map((c) => ({ bone: name(c.bone), target: name(c.target), links: c.links.map(name) }));
  }

  /** Turn all IK solvers of a model on or off (holds during playback, whatever the property track says). */
  setIkEnabled(modelId: string, enabled: boolean): void {
    const m = this.models.get(modelId);
    if (!m) return;
    m.ikEnabled = enabled;
    const model = m.model as MmdModel & { beforePhysics(frame: number | null): void };
    if (!m.rawBeforePhysics) {
      const raw = model.beforePhysics.bind(model);
      m.rawBeforePhysics = raw;
      model.beforePhysics = (frame: number | null): void => {
        raw(frame);
        if (!m.ikEnabled && frame !== null) {
          m.model.ikSolverStates.fill(0);
          raw(null);
        }
      };
    }
    m.model.ikSolverStates.fill(enabled ? 1 : 0);
    this.refreshPose();
  }

  /**
   * Fit IK targets to the FK pose: for each frame, evaluate with IK off and compute the VMD key
   * (position offset + rotation) that puts each IK bone on its chain's target bone. Parent IK bones are
   * fitted first so child IK bones (つま先ＩＫ under 足ＩＫ) are expressed relative to the fitted parent.
   */
  fitIkTargets(
    modelId: string,
    frames: number[],
    ikBones: string[],
  ): Record<string, { f: number; p: [number, number, number]; r: [number, number, number, number] }[]> {
    const m = this.models.get(modelId);
    const out: ReturnType<StudioEngine['fitIkTargets']> = {};
    if (!m) return out;
    const bones = m.model.runtimeBones;
    const depth = (i: number): number => {
      let d = 0;
      for (let b = bones[i].parentBone; b; b = b.parentBone) d++;
      return d;
    };
    const chains = ikBones
      .map((n) => m.ikChains.find((c) => bones[c.bone]?.name === n))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .sort((a, b) => depth(a.bone) - depth(b.bone));
    for (const c of chains) out[bones[c.bone].name] = [];
    const model = m.model as MmdModel & { beforePhysics(frame: number | null): void; afterPhysics(): void };
    const before = m.rawBeforePhysics ?? model.beforePhysics.bind(model);
    const states = m.model.ikSolverStates.slice();
    const tmpQ = new Quaternion();
    const tmpT = new Vector3();
    for (const f of frames) {
      before(f);
      m.model.ikSolverStates.fill(0);
      before(null);
      model.afterPhysics();
      const fitted = new Map<number, Matrix>();
      for (const c of chains) {
        const parent = bones[c.bone].parentBone;
        const pi = parent ? bones.indexOf(parent) : -1;
        const parentWorld =
          pi < 0 ? Matrix.Identity() : (fitted.get(pi) ?? parent!.getWorldMatrixToRef(new Matrix()).clone());
        const targetWorld = bones[c.target].getWorldMatrixToRef(new Matrix()).clone();
        // Row-vector convention: W = L · P  ⇒  L = W · P⁻¹.
        const local = targetWorld.multiply(Matrix.Invert(parentWorld));
        local.decompose(undefined, tmpQ, tmpT);
        const rest = m.restPositions[c.bone];
        out[bones[c.bone].name].push({
          f,
          p: [tmpT.x - rest.x, tmpT.y - rest.y, tmpT.z - rest.z],
          r: [tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w],
        });
        fitted.set(c.bone, targetWorld);
      }
    }
    m.model.ikSolverStates.set(states);
    void this.runtime.seekAnimation(this.runtime.currentFrameTime, true);
    return out;
  }

  private overlays = new Map<string, LinesMesh>();
  /** Debug/editor overlay lines in world space, drawn on top (utility layer). Null removes the overlay. */
  setOverlayLines(
    id: string,
    segments:
      { a: [number, number, number]; b: [number, number, number]; color: [number, number, number] }[] | null,
  ): void {
    const old = this.overlays.get(id);
    if (!segments || !segments.length) {
      old?.dispose();
      this.overlays.delete(id);
      return;
    }
    const lines = segments.map((sg) => [new Vector3(...sg.a), new Vector3(...sg.b)]);
    const colors = segments.map((sg) => {
      const c = new Color4(sg.color[0], sg.color[1], sg.color[2], 1);
      return [c, c];
    });
    const sameShape = old && old.getTotalVertices() === lines.length * 2;
    const mesh = CreateLineSystem(
      `overlay-${id}`,
      { lines, colors, updatable: true, instance: sameShape ? old : undefined },
      this.utilLayer.utilityLayerScene,
    );
    if (!sameShape) {
      old?.dispose();
      mesh.isPickable = false;
      this.overlays.set(id, mesh);
    }
  }

  async loadCameraMotion(file: VFile | null): Promise<CameraMotionInfo | null> {
    if (this.cameraMotion) {
      this.mmdCamera.setRuntimeAnimation(null);
      this.mmdCamera.destroyRuntimeAnimation(this.cameraMotion.handle);
      this.cameraMotion = null;
    }
    if (!file) {
      if (this.cameraMode === 'vmd') this.setCameraMode('orbit');
      this.updateDuration();
      this.applyPip();
      this.events.emit('cameraMotionChanged', null);
      return null;
    }
    const buffer = await file.blob.arrayBuffer();
    const animation = await this.vmdLoader.loadFromBufferAsync(basename(file.path), buffer);
    const handle = this.mmdCamera.createRuntimeAnimation(animation);
    this.mmdCamera.setRuntimeAnimation(handle);
    this.cameraMotion = { animation, handle };
    this.updateDuration();
    this.applyPip();
    await this.runtime.seekAnimation(this.runtime.currentFrameTime, true);
    const info: CameraMotionInfo = {
      name: basename(file.path),
      frameCount: animation.endFrame,
      frames: Array.from(animation.cameraTrack.frameNumbers),
    };
    this.events.emit('cameraMotionChanged', info);
    return info;
  }

  async loadAudio(file: VFile | null): Promise<AudioInfo | null> {
    if (!file) {
      this.audio.unload();
      this.updateDuration();
      this.events.emit('audioChanged', null);
      return null;
    }
    const info = await this.audio.load(file.blob, basename(file.path));
    this.updateDuration();
    this.events.emit('audioChanged', info);
    return info;
  }

  setAudioOffset(ms: number): void {
    this.audio.offsetSeconds = ms / 1000;
    this.updateDuration();
  }

  setVolume(volume: number): void {
    this.audio.setVolume(volume);
  }

  private text!: TextLayer;
  private previewMesh: Mesh | null = null;

  setPreviewMesh(data: { positions: Float32Array; indices: Uint32Array; colors: Float32Array; offset: [number, number, number] } | null): void {
    this.previewMesh?.dispose(false, true);
    this.previewMesh = null;
    if (!data) return;
    const mesh = new Mesh('converter-original', this.scene);
    const vd = new VertexData();
    vd.positions = data.positions;
    vd.indices = data.indices;
    vd.colors = data.colors;
    const normals: number[] = [];
    VertexData.ComputeNormals(data.positions, data.indices, normals);
    vd.normals = normals;
    vd.applyToMesh(mesh);
    const mat = new StandardMaterial('converter-original', this.scene);
    mat.backFaceCulling = false;
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mesh.material = mat;
    mesh.position.set(...data.offset);
    mesh.isPickable = false;
    this.shadowGen?.addShadowCaster(mesh, false);
    this.previewMesh = mesh;
  }

  setTextItems(items: TextItem[]): void {
    this.text.setItems(items);
  }

  setTextHandlers(h: TextPointerHandlers): void {
    this.text.setHandlers(h);
  }

  textStats(): { entries: number; meshes: number; materials: number; glow: boolean } {
    return this.text.stats();
  }

  textProbe(id: string): ReturnType<TextLayer['probe']> {
    return this.text.probe(id);
  }

  private minDuration = 0;
  /** Minimum playback length (the clip timeline's end, so text-only stretches play too). */
  setMinDuration(frames: number): void {
    this.minDuration = Math.max(0, frames);
    this.updateDuration();
  }

  private updateDuration(): void {
    let frames = this.minDuration;
    for (const m of this.models.values())
      if (m.motion) frames = Math.max(frames, m.motion.animation.endFrame);
    if (this.cameraMotion) frames = Math.max(frames, this.cameraMotion.animation.endFrame);
    if (this.audio.loaded) frames = Math.max(frames, (this.audio.duration - this.audio.offsetSeconds) * 30);
    this.runtime.setManualAnimationDuration(frames > 0 ? frames : null);
    this.emitPlayback(true);
  }

  // ---------------------------------------------------------------- playback
  async play(): Promise<void> {
    const pb = this.getPlayback();
    if (pb.duration > 0 && pb.frame >= pb.duration - 0.01) await this.runtime.seekAnimation(0, true);
    await this.runtime.playAnimation();
    this.emitPlayback(true);
  }

  pause(): void {
    this.runtime.pauseAnimation();
    this.emitPlayback(true);
  }

  stop(): void {
    this.runtime.pauseAnimation();
    void this.runtime.seekAnimation(0, true).then(() => this.emitPlayback(true));
  }

  seek(frame: number): void {
    const dur = this.runtime.animationFrameTimeDuration;
    const f = Math.max(0, Math.min(frame, dur));
    void this.runtime.seekAnimation(f, true).then(() => this.emitPlayback(true));
  }

  stepFrames(delta: number): void {
    if (this.runtime.isAnimationPlaying) this.runtime.pauseAnimation();
    this.seek(Math.round(this.runtime.currentFrameTime) + delta);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.runtime.timeScale = speed;
    this.emitPlayback(true);
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    this.emitPlayback(true);
  }

  // ---------------------------------------------------------------- camera
  setCameraMode(mode: CameraMode): void {
    if (mode === 'vmd' && !this.cameraMotion) {
      this.events.emit('warning', 'Load a camera VMD first to use the motion camera.');
      mode = 'orbit';
    }
    const prev = this.viewCamera();
    prev.detachControl();
    if (mode === 'fly' && this.cameraMode !== 'fly') {
      const src = this.cameraMode === 'vmd' ? this.mmdCamera : this.orbit;
      this.fly.position.copyFrom(src.globalPosition);
      this.fly.setTarget(this.cameraMode === 'vmd' ? this.mmdCamera.target : this.orbit.target);
      this.fly.fov = src.fov;
    }
    if (mode === 'orbit' && this.cameraMode === 'fly') {
      this.orbit.setPosition(this.fly.position.clone());
    }
    this.cameraMode = mode;
    const cam: Camera = mode === 'orbit' ? this.orbit : mode === 'fly' ? this.fly : this.mmdCamera;
    this.scene.activeCamera = cam;
    if (mode !== 'vmd') cam.attachControl(true);
    this.applyPip();
    this.scheduleCameraEmit();
  }

  /** Inset view through the VMD camera while the main view uses the orbit / fly camera. */
  setPip(enabled: boolean): void {
    this.pip = enabled;
    this.applyPip();
  }

  private applyPip(): void {
    const on = this.pip && this.cameraMode !== 'vmd' && !!this.cameraMotion;
    const main = this.viewCamera();
    const mgr = this.scene.postProcessRenderPipelineManager;
    if (on) {
      main.viewport = new Viewport(0, 0, 1, 1);
      this.mmdCamera.viewport = new Viewport(0.68, 0.03, 0.3, 0.3);
      if (!this.scene.activeCameras?.includes(this.mmdCamera)) {
        // Post-processing on a viewport inset is unreliable; the inset renders without it.
        mgr.detachCamerasFromRenderPipeline('post', this.mmdCamera);
        this.scene.activeCameras = [main, this.mmdCamera];
      } else this.scene.activeCameras = [main, this.mmdCamera];
    } else if (this.scene.activeCameras?.length) {
      this.scene.activeCameras = [];
      this.mmdCamera.viewport = new Viewport(0, 0, 1, 1);
      mgr.attachCamerasToRenderPipeline('post', this.mmdCamera);
      this.scene.activeCamera = main;
    }
    // Gizmos pick and draw through the main view's camera.
    this.utilLayer.setRenderCamera(on ? main : null);
  }

  /** The camera of the main view (not scene.activeCamera: after a PiP frame that is the inset camera). */
  private viewCamera(): Camera {
    return this.cameraMode === 'fly' ? this.fly : this.cameraMode === 'vmd' ? this.mmdCamera : this.orbit;
  }

  /** A draggable position gizmo at `pos` (world), for editor handles. Null hides it. */
  setPointGizmo(
    pos: [number, number, number] | null,
    cb: {
      onChange?: (p: [number, number, number]) => void;
      onEnd?: (p: [number, number, number]) => void;
    } = {},
  ): void {
    this.pointCb = pos ? cb : null;
    if (!pos) {
      this.pointGizmo.attachedNode = null;
      return;
    }
    this.pointNode.position.set(...pos);
    this.pointGizmo.attachedNode = this.pointNode;
  }

  setFov(fovDeg: number): void {
    const f = Math.min(120, Math.max(5, fovDeg)) * DEG;
    this.orbit.fov = f;
    this.fly.fov = f;
    this.scheduleCameraEmit();
  }

  /** Visible performers to frame; stages only when nothing else is loaded. */
  private framingModels(): ModelEntry[] {
    const visible = [...this.models.values()].filter((m) => m.visible);
    const performers = visible.filter((m) => !m.stage);
    return performers.length ? performers : visible;
  }

  /** First performer (non-stage) model, for camera defaults. */
  private defaultModelId(): string | undefined {
    return this.framingModels()[0]?.id;
  }

  /** World-space bounds from bone positions (mesh bounds in babylon-mmd are padded for skinning). */
  private modelBounds(id?: string): { center: Vector3; size: Vector3 } {
    const entries = id ? [this.models.get(id)].filter((m): m is ModelEntry => !!m) : this.framingModels();
    if (!entries.length) return { center: new Vector3(0, 10, 0), size: new Vector3(10, 20, 10) };
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    const tmp = new Vector3();
    for (const e of entries) {
      const world = e.mesh.computeWorldMatrix(true);
      for (const b of e.model.runtimeBones) {
        b.getWorldTranslationToRef(tmp);
        Vector3.TransformCoordinatesToRef(tmp, world, tmp);
        min.minimizeInPlace(tmp);
        max.maximizeInPlace(tmp);
      }
    }
    // Before the runtime's first update all bones report the origin: fall back to mesh bounds.
    if (max.y - min.y < 0.5) {
      for (const e of entries) {
        const b = e.mesh.getHierarchyBoundingVectors(true);
        min.minimizeInPlace(b.min);
        max.maximizeInPlace(b.max);
      }
      return { center: min.add(max).scale(0.5), size: max.subtract(min).scale(0.7) };
    }
    // Bones sit inside the mesh: pad a little so heads and feet are not cropped.
    const size = max.subtract(min);
    const pad = Math.max(size.y * 0.08, 0.5);
    min.addInPlaceFromFloats(-pad, -pad, -pad);
    max.addInPlaceFromFloats(pad, pad * 1.5, pad);
    return { center: min.add(max).scale(0.5), size: max.subtract(min) };
  }

  applyCameraPreset(preset: CameraPreset, modelId?: string): void {
    if (this.cameraMode !== 'orbit') this.setCameraMode('orbit');
    const id = modelId ?? this.selected?.modelId ?? this.defaultModelId();
    const { center, size } = this.modelBounds(id);
    const fit = (h: number): number => h / 2 / Math.tan(this.orbit.fov / 2) + size.z / 2;
    const radius = fit(Math.max(size.y, size.x * 0.75) * 1.1);
    const o = this.orbit;
    const set = (alpha: number, beta: number, r: number, target: Vector3): void => {
      // setTarget() recomputes angles from the current position, so it must come first.
      o.setTarget(target);
      o.alpha = alpha;
      o.beta = beta;
      o.radius = r;
    };
    switch (preset) {
      case 'front':
        set(-Math.PI / 2, Math.PI / 2.1, radius, center);
        break;
      case 'back':
        set(Math.PI / 2, Math.PI / 2.1, radius, center);
        break;
      case 'left':
        set(Math.PI, Math.PI / 2.1, radius, center);
        break;
      case 'right':
        set(0, Math.PI / 2.1, radius, center);
        break;
      case 'full':
        set(-Math.PI / 2 + 0.5, Math.PI / 2.4, radius * 1.1, center);
        break;
      case 'face': {
        const head = id ? this.findBoneWorld(id, HEAD_BONES) : null;
        // The head bone sits at the neck joint; aim slightly above it at the face.
        const target = head
          ? head.add(new Vector3(0, size.y * 0.06, 0))
          : center.add(new Vector3(0, size.y * 0.35, 0));
        set(-Math.PI / 2, Math.PI / 2.05, Math.max(2, fit(size.y * 0.3)), target);
        break;
      }
    }
  }

  setFollow(follow: { modelId: string; bone: string } | null): void {
    this.follow = follow;
  }

  focusModel(id?: string): void {
    if (this.cameraMode === 'vmd') this.setCameraMode('orbit');
    const { center, size } = this.modelBounds(id);
    const r = (Math.max(size.y, size.x * 0.75) * 1.1) / 2 / Math.tan(this.orbit.fov / 2) + size.z / 2;
    if (this.cameraMode === 'fly') {
      this.fly.position = center.add(new Vector3(0, 0, -r));
      this.fly.setTarget(center);
    } else {
      this.orbit.setTarget(center);
      this.orbit.radius = r;
    }
  }

  getCameraState(): CameraState {
    const o = this.orbit;
    return {
      mode: this.cameraMode,
      fov: Math.round((o.fov / DEG) * 10) / 10,
      target: [o.target.x, o.target.y, o.target.z],
      alpha: o.alpha,
      beta: o.beta,
      radius: o.radius,
      follow: this.follow,
    };
  }

  setCameraState(s: CameraState): void {
    const o = this.orbit;
    o.setTarget(new Vector3(...s.target));
    o.alpha = s.alpha;
    o.beta = s.beta;
    o.radius = s.radius;
    this.setFov(s.fov);
    this.follow = s.follow;
    this.setCameraMode(s.mode === 'vmd' && !this.cameraMotion ? 'orbit' : s.mode);
  }

  private scheduleCameraEmit(): void {
    if (this.cameraEmitTimer) clearTimeout(this.cameraEmitTimer);
    this.cameraEmitTimer = setTimeout(() => this.events.emit('cameraChanged', this.getCameraState()), 400);
  }

  private boneWorldPosition(modelId: string, boneName: string): Vector3 | null {
    return this.findBoneWorld(modelId, [boneName]);
  }

  private findBoneWorld(modelId: string, names: string[]): Vector3 | null {
    const m = this.models.get(modelId);
    if (!m) return null;
    const bone = m.model.runtimeBones.find((b) => names.includes(b.name));
    if (!bone) return null;
    const local = bone.getWorldTranslationToRef(new Vector3());
    return Vector3.TransformCoordinates(local, m.mesh.getWorldMatrix());
  }

  focusDofOnHead(modelId?: string): number | null {
    const id = modelId ?? this.selected?.modelId ?? this.defaultModelId();
    if (!id) return null;
    const head = this.findBoneWorld(id, HEAD_BONES) ?? this.modelBounds(id).center;
    const cam = this.viewCamera();
    if (!cam) return null;
    return Math.round(Vector3.Distance(cam.globalPosition, head) * 100) / 100;
  }

  // ---------------------------------------------------------------- posing
  selectBone(modelId: string | null, bone: number | null): void {
    if (modelId === null || bone === null || !this.models.has(modelId)) {
      this.selected = null;
      this.rotationGizmo.attachedNode = null;
      this.positionGizmo.attachedNode = null;
      this.events.emit('boneSelected', null);
      return;
    }
    this.selected = { modelId, bone };
    this.syncProxyToBone();
    this.setGizmoMode(this.gizmoMode);
    this.events.emit('boneSelected', { modelId, bone });
  }

  setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    const active = this.activeModelId ? this.models.get(this.activeModelId) : undefined;
    this.scaleGizmo.attachedMesh = mode === 'scale' && active ? active.mesh : null;
    this.moveGizmo.attachedMesh = mode === 'move' && active ? active.mesh : null;
    const bone = this.selected !== null && mode !== 'scale' && mode !== 'move';
    this.rotationGizmo.attachedNode = bone && mode === 'rotate' ? this.gizmoProxy : null;
    this.positionGizmo.attachedNode = bone && mode === 'translate' ? this.gizmoProxy : null;
  }

  setActiveModel(id: string | null): void {
    this.activeModelId = id && this.models.has(id) ? id : null;
    this.setGizmoMode(this.gizmoMode);
  }

  /**
   * Touch picking: a tap near a bone of the active model selects that bone; otherwise the tapped
   * model. Coordinates are CSS pixels relative to the canvas.
   */
  pickAt(x: number, y: number, radius = 28): { modelId: string; bone: number | null } | null {
    const cam = this.viewCamera();
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const viewport = cam.viewport.toGlobal(w, h);
    const transform = cam.getTransformationMatrix();
    const scaling = this.engine.getHardwareScalingLevel();
    // Taps on gizmo handles belong to the gizmo, not to selection.
    const gizmoHit = this.utilLayer.utilityLayerScene.pick(x / scaling, y / scaling);
    if (gizmoHit?.hit) return { modelId: '', bone: null };
    const active = this.activeModelId ? this.models.get(this.activeModelId) : undefined;
    if (active?.visible) {
      const world = active.mesh.getWorldMatrix();
      const tmp = new Vector3();
      const screen = active.model.runtimeBones.map((b) => {
        b.getWorldTranslationToRef(tmp);
        const p = Vector3.Project(
          Vector3.TransformCoordinates(tmp, world),
          Matrix.IdentityReadOnly,
          transform,
          viewport,
        );
        return p.z < 0 || p.z > 1 ? null : { x: p.x, y: p.y };
      });
      const hit = nearestWithin(screen, { x, y }, radius);
      if (hit >= 0) return { modelId: active.id, bone: hit };
    }
    const pick = this.scene.pick(
      x / scaling,
      y / scaling,
      (mesh) => mesh.isPickable && mesh.isEnabled() && mesh.isVisible,
      false,
      cam,
    );
    if (pick?.hit && pick.pickedMesh) {
      for (const m of this.models.values()) {
        if (m.container.meshes.includes(pick.pickedMesh)) return { modelId: m.id, bone: null };
      }
    }
    return null;
  }

  private boneWorldMatrix(m: ModelEntry, index: number): Matrix {
    const bone = m.model.runtimeBones[index];
    const local = bone.getWorldMatrixToRef(new Matrix());
    return local.multiply(m.mesh.getWorldMatrix());
  }

  private syncProxyToBone(): void {
    if (!this.selected) return;
    const m = this.models.get(this.selected.modelId);
    if (!m) return;
    const world = this.boneWorldMatrix(m, this.selected.bone);
    const scale = new Vector3();
    const rot = new Quaternion();
    const pos = new Vector3();
    world.decompose(scale, rot, pos);
    this.gizmoProxy.position.copyFrom(pos);
    this.gizmoProxy.rotationQuaternion = rot;
  }

  private onGizmoDragStart(): void {
    if (!this.selected) return;
    const m = this.models.get(this.selected.modelId);
    if (!m) return;
    if (this.runtime.isAnimationPlaying) this.pause();
    const bone = m.model.runtimeBones[this.selected.bone];
    const parentRot = new Quaternion();
    if (bone.parentBone) {
      const pIdx = m.model.runtimeBones.indexOf(bone.parentBone);
      this.boneWorldMatrix(m, pIdx).decompose(undefined, parentRot, undefined);
    } else {
      m.mesh.getWorldMatrix().decompose(undefined, parentRot, undefined);
    }
    this.dragging = {
      startLocal: this.getBoneTransform(m.id, this.selected.bone)!,
      proxyRot: this.gizmoProxy.rotationQuaternion!.clone(),
      proxyPos: this.gizmoProxy.position.clone(),
      parentRot,
      meshScale: m.mesh.scaling.x,
    };
  }

  private onGizmoDrag(): void {
    if (!this.selected || !this.dragging) return;
    const m = this.models.get(this.selected.modelId);
    if (!m) return;
    const d = this.dragging;
    const linked = m.model.runtimeBones[this.selected.bone].linkedBone;
    if (this.gizmoMode === 'rotate') {
      // Row-vector convention: W = L * P and W' = W * D  =>  L' = L * P * D * P^-1
      const D = Quaternion.Inverse(d.proxyRot).multiply(this.gizmoProxy.rotationQuaternion!);
      const L = new Quaternion(...d.startLocal.rotation);
      const mL = Matrix.FromQuaternionToRef(L, new Matrix());
      const mP = Matrix.FromQuaternionToRef(d.parentRot, new Matrix());
      const mD = Matrix.FromQuaternionToRef(D, new Matrix());
      const result = mL.multiply(mP).multiply(mD).multiply(Matrix.Invert(mP));
      const q = Quaternion.FromRotationMatrix(result).normalize();
      linked.rotationQuaternion = q;
    } else {
      const deltaWorld = this.gizmoProxy.position.subtract(d.proxyPos);
      const inv = Matrix.FromQuaternionToRef(Quaternion.Inverse(d.parentRot), new Matrix());
      const local = Vector3.TransformNormal(deltaWorld, inv).scale(1 / Math.max(0.01, d.meshScale));
      linked.position = new Vector3(...d.startLocal.position).add(local);
    }
  }

  private onGizmoDragEnd(): void {
    if (!this.selected || !this.dragging) return;
    const before = this.dragging.startLocal;
    this.dragging = null;
    const after = this.getBoneTransform(this.selected.modelId, this.selected.bone);
    if (after)
      this.events.emit('boneEdited', {
        modelId: this.selected.modelId,
        bone: this.selected.bone,
        before,
        after,
      });
  }

  getBoneTransform(modelId: string, bone: number): BoneLocalTransform | null {
    const b = this.models.get(modelId)?.model.runtimeBones[bone];
    if (!b) return null;
    const q = b.linkedBone.rotationQuaternion;
    const p = b.linkedBone.position;
    return { rotation: [q.x, q.y, q.z, q.w], position: [p.x, p.y, p.z] };
  }

  setBoneTransform(modelId: string, bone: number, t: BoneLocalTransform): void {
    const b = this.models.get(modelId)?.model.runtimeBones[bone];
    if (!b) return;
    b.linkedBone.rotationQuaternion = new Quaternion(...t.rotation);
    b.linkedBone.position = new Vector3(...t.position);
  }

  getPose(modelId: string): PoseData | null {
    const m = this.models.get(modelId);
    if (!m) return null;
    const bones: PoseData['bones'] = [];
    m.model.runtimeBones.forEach((b, i) => {
      const q = b.linkedBone.rotationQuaternion;
      const p = b.linkedBone.position.subtract(m.restPositions[i]);
      const rotated = Math.abs(q.w) < 0.99999;
      const moved = p.lengthSquared() > 1e-8;
      if (rotated || moved)
        bones.push({ name: b.name, rotation: [q.x, q.y, q.z, q.w], position: [p.x, p.y, p.z] });
    });
    const morphs = Object.fromEntries(
      Object.entries(this.getMorphWeights(modelId)).filter(([, v]) => v !== 0),
    );
    return { version: 1, model: m.name, bones, morphs };
  }

  applyPose(modelId: string, pose: PoseData): void {
    const m = this.models.get(modelId);
    if (!m) return;
    this.resetPose(modelId);
    const byName = new Map(m.model.runtimeBones.map((b, i) => [b.name, i]));
    for (const pb of pose.bones) {
      const i = byName.get(pb.name);
      if (i === undefined) continue;
      const lb = m.model.runtimeBones[i].linkedBone;
      lb.rotationQuaternion = new Quaternion(...pb.rotation);
      lb.position = m.restPositions[i].add(new Vector3(...pb.position));
    }
    for (const [k, v] of Object.entries(pose.morphs)) m.model.morph.setMorphWeight(k, v);
    this.events.emit('morphsChanged', { modelId });
  }

  resetPose(modelId: string): void {
    const m = this.models.get(modelId);
    if (!m) return;
    if (this.runtime.isAnimationPlaying) this.pause();
    m.model.runtimeBones.forEach((b, i) => {
      b.linkedBone.rotationQuaternion = Quaternion.Identity();
      b.linkedBone.position = m.restPositions[i].clone();
    });
    m.model.morph.resetMorphWeights();
    this.runtime.initializeMmdModelPhysics(m.model);
    this.events.emit('morphsChanged', { modelId });
  }

  resetPhysics(): void {
    this.runtime.initializeAllMmdModelsPhysics(false);
  }

  /** iOS only allows audio after a user gesture: call from the first tap. */
  unlockAudio(): void {
    this.audio.unlock();
  }

  setRenderPaused(paused: boolean): void {
    this.renderPaused = paused;
  }

  getFps(): number {
    return this.engine.getFps();
  }

  onBeforeFrame(cb: (deltaMs: number) => void): () => void {
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      try {
        cb(this.engine.getDeltaTime());
      } catch (err) {
        this.events.emit('error', `Script error: ${err instanceof Error ? err.message : String(err)}`);
        obs.remove();
      }
    });
    return () => obs.remove();
  }

  // ---------------------------------------------------------------- capture
  /** Hides helpers (grid, gizmos) and optionally the background for a capture. Returns a restore fn. */
  private prepareCapture(transparent: boolean): () => void {
    const gridOn = this.grid.isEnabled();
    const axesOn = this.axes !== null;
    const layerOn = this.bgLayer?.isEnabled ?? false;
    const skyOn = this.skybox?.isEnabled() ?? false;
    const clear = this.scene.clearColor.clone();
    const groundOn = this.shadowGround.isEnabled();
    const rot = this.rotationGizmo.attachedNode;
    const pos = this.positionGizmo.attachedNode;
    this.grid.setEnabled(false);
    this.axes?.dispose();
    this.axes = null;
    this.rotationGizmo.attachedNode = null;
    this.positionGizmo.attachedNode = null;
    if (transparent) {
      if (this.bgLayer) this.bgLayer.isEnabled = false;
      this.skybox?.setEnabled(false);
      this.scene.clearColor = new Color4(0, 0, 0, 0);
    }
    return () => {
      this.grid.setEnabled(gridOn);
      if (axesOn) this.axes = new AxesViewer(this.scene, 3);
      if (this.bgLayer) this.bgLayer.isEnabled = layerOn;
      this.skybox?.setEnabled(skyOn);
      this.scene.clearColor = clear;
      this.shadowGround.setEnabled(groundOn);
      this.rotationGizmo.attachedNode = rot;
      this.positionGizmo.attachedNode = pos;
    };
  }

  /** Temporarily render at an exact pixel size. Returns a restore fn. */
  private setRenderSize(width: number, height: number): () => void {
    const scaling = this.engine.getHardwareScalingLevel();
    this.capturing = true;
    this.engine.setHardwareScalingLevel(1);
    this.engine.setSize(width, height);
    return () => {
      this.engine.setHardwareScalingLevel(scaling);
      this.capturing = false;
      this.engine.resize();
    };
  }

  async screenshot(o: ScreenshotOptions): Promise<Blob> {
    const restoreCapture = this.prepareCapture(o.transparent);
    const restoreSize = this.setRenderSize(o.width, o.height);
    try {
      // Render twice so post-processes and shadow maps settle at the new resolution.
      this.scene.render();
      this.scene.render();
      return await new Promise<Blob>((resolve, reject) => {
        this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Screenshot failed'))), 'image/png');
      });
    } finally {
      restoreSize();
      restoreCapture();
    }
  }

  async record(
    o: RecordOptions,
    onProgress: (p: RecordProgress) => void,
    signal: AbortSignal,
  ): Promise<Blob> {
    const restoreCapture = this.prepareCapture(false);
    const restoreSize = this.setRenderSize(o.width, o.height);
    const wasLoop = this.loop;
    this.loop = false;
    this.pause();
    try {
      await this.runtime.seekAnimation(o.startFrame, true);
      // Warm up at the capture size so resizing and shader compilation don't eat into the take.
      this.scene.render();
      this.scene.render();
      if (o.deterministic) {
        const engine = this.engine;
        const originalDelta = engine.getDeltaTime.bind(engine);
        engine.getDeltaTime = () => 1000 / o.fps;
        this.audio.suspended = true;
        try {
          if (o.mimeType === PNG_SEQUENCE_MIME) {
            return await recordPngSequence({
              canvas: this.canvas,
              options: o,
              signal,
              onProgress,
              renderFrame: () => this.scene.render(),
              begin: () => this.runtime.playAnimation(),
            });
          }
          return await recordDeterministic({
            canvas: this.canvas,
            options: o,
            audioBuffer: o.includeAudio ? this.audio.buffer : null,
            audioOffset: this.audio.offsetSeconds,
            signal,
            onProgress,
            renderFrame: () => this.scene.render(),
            begin: () => this.runtime.playAnimation(),
          });
        } finally {
          engine.getDeltaTime = originalDelta;
          this.audio.suspended = false;
        }
      }
      // realtime: the normal render loop is paused while capturing; drive it ourselves.
      // Clamp frame deltas so a single slow frame can't jump the animation past the range.
      const engine = this.engine;
      const originalDelta = engine.getDeltaTime.bind(engine);
      engine.getDeltaTime = () => Math.min(originalDelta(), 1000 / 15);
      let raf = 0;
      const tick = (): void => {
        this.scene.render();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      try {
        return await recordRealtime({
          canvas: this.canvas,
          options: o,
          audioStream: o.includeAudio ? this.audio.mediaStream : null,
          signal,
          onProgress,
          currentFrame: () => this.runtime.currentFrameTime,
          isPlaying: () => this.runtime.isAnimationPlaying,
          begin: () => this.runtime.playAnimation(),
        });
      } finally {
        cancelAnimationFrame(raf);
        engine.getDeltaTime = originalDelta;
      }
    } finally {
      this.pause();
      this.loop = wasLoop;
      restoreSize();
      restoreCapture();
    }
  }

  // exposed for tests / debugging
  get _scene(): Scene {
    return this.scene;
  }
  get _meshes(): AbstractMesh[] {
    return this.scene.meshes;
  }
}
