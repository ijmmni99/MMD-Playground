// 3D text clips in the scene: one merged mesh + one material per clip, placed (fixed / billboard /
// bone / caption), animated per frame from the playhead, and disposed when the clip goes away.

import {
  Color3,
  GlowLayer,
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

  constructor(private readonly host: TextLayerHost) {
    this.obs = host.scene.onBeforeRenderObservable.add(() => this.update());
  }

  setItems(items: readonly TextItem[]): void {
    const keep = new Set(items.map((i) => i.id));
    for (const [id, e] of this.entries) if (!keep.has(id)) this.remove(id, e);
    for (const item of items) {
      const e = this.entries.get(item.id);
      if (e && e.item.mesh === item.mesh) {
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
  } | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const w = e.mesh.computeWorldMatrix(true);
    const p = w.getTranslation();
    // Front faces local -z.
    const n = Vector3.TransformNormal(new Vector3(0, 0, -1), w).normalize();
    const c = this.host.scene.activeCamera?.globalPosition ?? Vector3.Zero();
    return {
      visible: e.mesh.isEnabled() && e.mesh.visibility > 0,
      position: [p.x, p.y, p.z],
      normal: [n.x, n.y, n.z],
      camera: [c.x, c.y, c.z],
    };
  }

  dispose(): void {
    this.obs.remove();
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
    const e: Entry = { item, root, mesh, mat, base: pos, lettersActive: false, caster: false, styleKey: '' };
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
