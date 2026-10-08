// 3D text clips in the scene: one merged mesh + one material per clip, placed (fixed / billboard /
// bone / caption), animated per frame from the playhead, and disposed when the clip goes away.

import {
  Color3,
  GlowLayer,
  Matrix,
  Mesh,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  type Camera,
  type Scene,
  type ShadowGenerator,
} from '@babylonjs/core';
import { textAnimState } from '@/lib/clips/text/anim';
import type { TextItem } from '../StudioEngine';

export interface TextLayerHost {
  scene: Scene;
  shadowGen: () => ShadowGenerator | null;
  frame: () => number;
  bone: (modelId: string, bone: string) => Vector3 | null;
  /** Render coordinates per CSS pixel (hardware scaling). */
  scaling: () => number;
}

/** Drag-to-move results: the clip's new `position`, or a tap (no movement). */
export interface TextPointerHandlers {
  onMove?: (id: string, position: [number, number, number]) => void;
  onTap?: (id: string) => void;
}

interface Entry {
  item: TextItem;
  root: TransformNode;
  mesh: Mesh;
  mat: StandardMaterial;
  /** Rest positions (per-letter animation writes into the vertex buffer). */
  base: Float32Array;
  lettersActive: boolean;
  caster: boolean;
  styleKey: string;
  /** Caption: visible view height at its distance (drag conversion). */
  visH: number;
  /** Dropped offset shown until the moved clip arrives. */
  pending: Vector3 | null;
}

const DEG = Math.PI / 180;
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpS = new Vector3();

function hex(c: string): Color3 {
  try {
    return Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff');
  } catch {
    return Color3.White();
  }
}

export class TextLayer {
  private readonly entries = new Map<string, Entry>();
  private glow: GlowLayer | null = null;
  private readonly obs;
  private handlers: TextPointerHandlers = {};
  /** Live offset of the text being dragged (world units). */
  private drag: {
    id: string;
    pointer: number;
    start: Vector3;
    normal: Vector3;
    delta: Vector3;
    x0: number;
    y0: number;
    moved: boolean;
  } | null = null;
  private readonly canvas: HTMLCanvasElement | null;
  private readonly listeners: [string, (e: PointerEvent) => void][] = [];

  constructor(private readonly host: TextLayerHost) {
    this.obs = host.scene.onBeforeRenderObservable.add(() => this.update());
    this.canvas = host.scene.getEngine().getRenderingCanvas();
    // Capture phase on the canvas: a press on text drags it instead of orbiting the camera.
    const on = (type: string, fn: (e: PointerEvent) => void): void => {
      this.canvas?.addEventListener(type, fn as EventListener, { capture: true });
      this.listeners.push([type, fn]);
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e, false));
    on('pointercancel', (e) => this.onUp(e, true));
  }

  setHandlers(h: TextPointerHandlers): void {
    this.handlers = h;
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.canvas!.getBoundingClientRect();
    const s = this.host.scaling();
    return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
  }

  /** Where a screen point's ray meets the drag plane. */
  private planePoint(e: PointerEvent, origin: Vector3, normal: Vector3): Vector3 | null {
    const cam = this.host.scene.activeCamera;
    if (!cam) return null;
    const [x, y] = this.local(e);
    const ray = this.host.scene.createPickingRay(x, y, null, cam);
    const denom = Vector3.Dot(ray.direction, normal);
    if (Math.abs(denom) < 1e-6) return null;
    const t = Vector3.Dot(origin.subtract(ray.origin), normal) / denom;
    return t > 0 ? ray.origin.add(ray.direction.scale(t)) : null;
  }

  private onDown(e: PointerEvent): void {
    if (this.drag || !this.entries.size || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const cam = this.host.scene.activeCamera;
    if (!cam) return;
    const [x, y] = this.local(e);
    // Hit = inside a text's on-screen box (padded): gaps between letters and thin strokes still count.
    const hit = this.hitTest(x, y, cam);
    if (!hit) return;
    const { id, point } = hit;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.canvas?.setPointerCapture(e.pointerId);
    const normal = cam.getDirection(Vector3.Forward()).normalize();
    this.drag = { id, pointer: e.pointerId, start: point, normal, delta: Vector3.Zero(), x0: e.clientX, y0: e.clientY, moved: false };
  }

  /** Topmost (nearest) text whose projected bounding box contains the render-space point. */
  private hitTest(x: number, y: number, cam: Camera): { id: string; point: Vector3 } | null {
    const eng = this.host.scene.getEngine();
    const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    const t = this.host.scene.getTransformMatrix();
    const pad = 12 / this.host.scaling();
    let best: { id: string; point: Vector3; z: number } | null = null;
    for (const [id, e] of this.entries) {
      if (!e.mesh.isEnabled() || e.mesh.visibility <= 0) continue;
      e.mesh.computeWorldMatrix(true);
      const box = e.mesh.getBoundingInfo().boundingBox;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let z = Infinity;
      for (const c of box.vectorsWorld) {
        const p = Vector3.Project(c, Matrix.IdentityReadOnly, t, vp);
        if (p.z < 0 || p.z > 1) continue;
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
        z = Math.min(z, p.z);
      }
      if (x < x0 - pad || x > x1 + pad || y < y0 - pad || y > y1 + pad) continue;
      if (best && best.z <= z) continue;
      // Grab point: where the ray meets the text's plane (facing the camera through its center).
      const n = cam.getDirection(Vector3.Forward()).normalize();
      const ray = this.host.scene.createPickingRay(x, y, null, cam);
      const center = box.centerWorld;
      const denom = Vector3.Dot(ray.direction, n);
      const k = Math.abs(denom) < 1e-6 ? 0 : Vector3.Dot(center.subtract(ray.origin), n) / denom;
      best = { id, point: ray.origin.add(ray.direction.scale(k)), z };
    }
    return best ? { id: best.id, point: best.point } : null;
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    d.moved = true;
    const p = this.planePoint(e, d.start, d.normal);
    if (p) d.delta = p.subtract(d.start);
  }

  private onUp(e: PointerEvent, cancel: boolean): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    e.stopImmediatePropagation();
    this.drag = null;
    const entry = this.entries.get(d.id);
    if (!entry || cancel) return;
    if (!d.moved) {
      this.handlers.onTap?.(d.id);
      return;
    }
    const spec = entry.item.spec;
    const pos = [...spec.position] as [number, number, number];
    if (spec.placement === 'caption') {
      // Captions move up / down the screen (position[1] is a percentage of the view height).
      const cam = this.host.scene.activeCamera;
      const up = cam ? cam.getDirection(Vector3.Up()) : Vector3.Up();
      pos[1] = Math.round((pos[1] + (Vector3.Dot(d.delta, up) / Math.max(1e-6, entry.visH)) * 100) * 10) / 10;
    } else {
      pos[0] = round3(pos[0] + d.delta.x);
      pos[1] = round3(pos[1] + d.delta.y);
      pos[2] = round3(pos[2] + d.delta.z);
    }
    // Keep showing the dropped position until the edited clip comes back.
    entry.pending = d.delta.clone();
    this.handlers.onMove?.(d.id, pos);
  }

  setItems(items: readonly TextItem[]): void {
    const keep = new Set(items.map((i) => i.id));
    for (const [id, e] of this.entries) if (!keep.has(id)) this.remove(id, e);
    for (const item of items) {
      const e = this.entries.get(item.id);
      if (e && e.item.mesh === item.mesh) {
        if (e.item.spec.position !== item.spec.position) e.pending = null;
        e.item = item;
        this.applyStyle(e);
      } else {
        if (e) this.remove(item.id, e);
        this.entries.set(item.id, this.create(item));
      }
    }
    this.syncGlow();
    this.update();
  }

  /** Counts for leak checks. */
  stats(): { entries: number; meshes: number; materials: number; glow: boolean } {
    const scene = this.host.scene;
    return {
      entries: this.entries.size,
      meshes: scene.meshes.filter((m) => m.name.startsWith('text:')).length,
      materials: scene.materials.filter((m) => m.name.startsWith('text:')).length,
      glow: this.glow !== null,
    };
  }

  /** World placement of a clip's text (tests: bone follow, billboard facing). */
  probe(
    id: string,
  ): {
    visible: boolean;
    position: [number, number, number];
    normal: [number, number, number];
    camera: [number, number, number];
    screen: [number, number];
  } | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const w = e.mesh.computeWorldMatrix(true);
    const p = w.getTranslation();
    // Front faces local -z.
    const n = Vector3.TransformNormal(new Vector3(0, 0, -1), w).normalize();
    const cam = this.host.scene.activeCamera;
    const c = cam?.globalPosition ?? Vector3.Zero();
    // Screen point (CSS px in the page) of the text's bounding-box center.
    let screen: [number, number] = [NaN, NaN];
    if (cam && this.canvas) {
      const eng = this.host.scene.getEngine();
      const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
      const center = e.mesh.getBoundingInfo().boundingBox.centerWorld;
      const sp = Vector3.Project(center, Matrix.IdentityReadOnly, this.host.scene.getTransformMatrix(), vp);
      const r = this.canvas.getBoundingClientRect();
      const k = this.host.scaling();
      screen = [r.left + sp.x * k, r.top + sp.y * k];
    }
    return {
      screen,
      visible: e.mesh.isEnabled() && e.mesh.visibility > 0,
      position: [p.x, p.y, p.z],
      normal: [n.x, n.y, n.z],
      camera: [c.x, c.y, c.z],
    };
  }

  dispose(): void {
    this.obs.remove();
    for (const [type, fn] of this.listeners) this.canvas?.removeEventListener(type, fn as EventListener, { capture: true });
    for (const [id, e] of this.entries) this.remove(id, e);
    this.glow?.dispose();
    this.glow = null;
  }

  // ---------------------------------------------------------------- build

  private create(item: TextItem): Entry {
    const scene = this.host.scene;
    const root = new TransformNode(`text:${item.id}:root`, scene);
    const mesh = new Mesh(`text:${item.id}`, scene);
    mesh.parent = root;
    const vd = new VertexData();
    // Geometry is right-handed with the front toward +z; Babylon is left-handed and a front faces -z.
    const pos = item.mesh.positions.slice();
    const nrm = item.mesh.normals.slice();
    for (let i = 2; i < pos.length; i += 3) {
      pos[i] = -pos[i];
      nrm[i] = -nrm[i];
    }
    vd.positions = pos;
    vd.normals = nrm;
    vd.indices = item.mesh.indices;
    vd.applyToMesh(mesh, true);
    const mat = new StandardMaterial(`text:${item.id}`, scene);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    const e: Entry = { item, root, mesh, mat, base: pos, lettersActive: false, caster: false, styleKey: '', visH: 1, pending: null };
    this.applyStyle(e);
    return e;
  }

  private remove(id: string, e: Entry): void {
    this.host.shadowGen()?.removeShadowCaster(e.mesh, false);
    this.glow?.removeIncludedOnlyMesh(e.mesh);
    e.mesh.dispose(false, true);
    e.root.dispose();
    this.entries.delete(id);
  }

  private applyStyle(e: Entry): void {
    const s = e.item.spec;
    const key = [s.style, s.color, s.color2, s.onTop, s.castShadow, s.placement].join('|');
    if (key === e.styleKey) return;
    e.styleKey = key;
    const m = e.mat;
    const c1 = hex(s.color);
    const c2 = hex(s.color2);
    m.disableLighting = false;
    m.alpha = 1;
    m.emissiveColor = Color3.Black();
    m.diffuseColor = c1;
    m.specularColor = new Color3(0.15, 0.15, 0.15);
    m.specularPower = 32;
    m.backFaceCulling = true;
    e.mesh.renderOutline = false;
    e.mesh.removeVerticesData(VertexBuffer.ColorKind);
    switch (s.style) {
      case 'glossy':
        m.specularColor = new Color3(0.9, 0.9, 0.9);
        m.specularPower = 96;
        m.emissiveColor = c1.scale(0.12);
        break;
      case 'neon':
        m.diffuseColor = Color3.Black();
        m.emissiveColor = c1;
        m.specularColor = Color3.Black();
        m.disableLighting = true;
        break;
      case 'gradient': {
        // Top → bottom: color → color2 (vertex colors over the diffuse white).
        m.diffuseColor = Color3.White();
        const p = e.base;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 1; i < p.length; i += 3) {
          minY = Math.min(minY, p[i]);
          maxY = Math.max(maxY, p[i]);
        }
        const colors = new Float32Array((p.length / 3) * 4);
        for (let v = 0; v < p.length / 3; v++) {
          const t = maxY > minY ? (p[v * 3 + 1] - minY) / (maxY - minY) : 1;
          colors[v * 4] = c2.r + (c1.r - c2.r) * t;
          colors[v * 4 + 1] = c2.g + (c1.g - c2.g) * t;
          colors[v * 4 + 2] = c2.b + (c1.b - c2.b) * t;
          colors[v * 4 + 3] = 1;
        }
        e.mesh.setVerticesData(VertexBuffer.ColorKind, colors, false, 4);
        m.specularColor = new Color3(0.5, 0.5, 0.5);
        break;
      }
      case 'outline':
        m.specularColor = Color3.Black();
        m.emissiveColor = c1.scale(0.35);
        e.mesh.renderOutline = true;
        e.mesh.outlineColor = c2;
        e.mesh.outlineWidth = Math.max(0.01, e.item.spec.size * 0.03);
        break;
      case 'glass':
        m.alpha = 0.45;
        m.specularColor = Color3.White();
        m.specularPower = 128;
        m.emissiveColor = c1.scale(0.2);
        m.backFaceCulling = false;
        break;
    }
    const group = s.onTop || s.placement === 'caption' ? 1 : 0;
    e.mesh.renderingGroupId = group;
    const gen = this.host.shadowGen();
    const cast = s.castShadow && s.placement !== 'caption';
    if (gen && cast !== e.caster) {
      if (cast) gen.addShadowCaster(e.mesh, false);
      else gen.removeShadowCaster(e.mesh, false);
    }
    e.caster = cast;
  }

  private syncGlow(): void {
    const neon = [...this.entries.values()].filter((e) => e.item.spec.style === 'neon');
    if (!neon.length) {
      this.glow?.dispose();
      this.glow = null;
      return;
    }
    if (!this.glow) {
      this.glow = new GlowLayer('text:glow', this.host.scene, { mainTextureSamples: 1, blurKernelSize: 48 });
      this.glow.intensity = 0.9;
    }
    for (const e of this.entries.values()) {
      if (e.item.spec.style === 'neon') this.glow.addIncludedOnlyMesh(e.mesh);
      else this.glow.removeIncludedOnlyMesh(e.mesh);
    }
  }

  // ---------------------------------------------------------------- per frame

  private update(): void {
    if (!this.entries.size) return;
    const frame = this.host.frame();
    const cam = this.host.scene.activeCamera;
    for (const e of this.entries.values()) this.place(e, frame, cam);
  }

  private place(e: Entry, frame: number, cam: Camera | null): void {
    const { spec, start, length, mesh: data } = e.item;
    const st = textAnimState(spec, frame - start, length, data.glyphs.length);
    const show = st.visible && st.opacity > 0.001 && st.reveal > 0;
    if (e.mesh.isEnabled() !== show) e.mesh.setEnabled(show);
    if (!show) return;
    e.mesh.visibility = st.opacity;

    // Placement → root.
    const root = e.root;
    root.rotationQuaternion ??= new Quaternion();
    let scale = spec.scale;
    if (spec.placement === 'caption' && cam) {
      const w = cam.getWorldMatrix();
      w.decompose(tmpS, tmpQ, tmpV);
      const d = Math.max(cam.minZ * 40, 5);
      const visH = 2 * d * Math.tan((cam.fov || 0.8) / 2);
      const fwd = Vector3.TransformNormal(Vector3.Forward(), w).normalize();
      const up = Vector3.TransformNormal(Vector3.Up(), w).normalize();
      root.position.copyFrom(tmpV.add(fwd.scale(d)).add(up.scale(visH * (-0.4 + spec.position[1] * 0.01))));
      root.rotationQuaternion.copyFrom(tmpQ);
      scale *= visH * 0.034;
      e.visH = visH;
    } else {
      let p = new Vector3(spec.position[0], spec.position[1], spec.position[2]);
      if (spec.placement === 'bone' && spec.modelId && spec.bone) {
        const b = this.host.bone(spec.modelId, spec.bone);
        if (b) p = b.add(p);
      }
      root.position.copyFrom(p);
      if (spec.placement === 'fixed') {
        Quaternion.FromEulerAnglesToRef(
          spec.rotation[0] * DEG,
          spec.rotation[1] * DEG,
          spec.rotation[2] * DEG,
          root.rotationQuaternion,
        );
      } else if (cam) {
        // Billboard (also for bone-attached text): face the camera, screen-aligned.
        cam.getWorldMatrix().decompose(undefined, tmpQ, undefined);
        root.rotationQuaternion.copyFrom(tmpQ);
      }
    }
    root.scaling.setAll(scale);
    const live = this.drag?.id === e.item.id ? this.drag.delta : e.pending;
    if (live) root.position.addInPlace(live);

    // Animation → mesh local transform.
    const size = spec.size;
    e.mesh.position.set(st.offset[0] * size, st.offset[1] * size, st.offset[2] * size);
    e.mesh.rotationQuaternion ??= new Quaternion();
    Quaternion.FromEulerAnglesToRef(0, st.rotY, st.rotZ, e.mesh.rotationQuaternion);
    e.mesh.scaling.setAll(st.scale);

    // Typewriter: draw only the first glyphs (glyphs are stored in reading order).
    const sub = e.mesh.subMeshes?.[0];
    if (sub) {
      const n = Math.min(data.glyphs.length, st.reveal);
      const count =
        n >= data.glyphs.length
          ? data.indices.length
          : n > 0
            ? data.glyphs[n - 1].indexStart + data.glyphs[n - 1].indexCount
            : 0;
      if (sub.indexCount !== count) sub.indexCount = count;
    }

    // Per-letter offsets (wave) rewrite positions while active, then restore once.
    if (st.letters) {
      const out = e.base.slice();
      for (const g of data.glyphs) {
        const l = st.letters[g.index];
        if (!l) continue;
        const [cx, cy] = g.center;
        for (let v = g.vertexStart; v < g.vertexStart + g.vertexCount; v++) {
          out[v * 3] = cx + (e.base[v * 3] - cx) * l.scale;
          out[v * 3 + 1] = cy + (e.base[v * 3 + 1] - cy) * l.scale + l.dy * size;
          out[v * 3 + 2] = e.base[v * 3 + 2] * l.scale;
        }
      }
      e.mesh.updateVerticesData(VertexBuffer.PositionKind, out);
      e.lettersActive = true;
    } else if (e.lettersActive) {
      e.mesh.updateVerticesData(VertexBuffer.PositionKind, e.base);
      e.lettersActive = false;
    }
  }
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
