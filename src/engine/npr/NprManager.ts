// Applies look presets to a model's materials: resolves looks (preset + overrides + global quick controls), picks
// the shader variant for the quality tier, attaches / updates NprLookPlugin, sets alpha handling, and falls back to
// the PMX original if a variant fails to compile.

import { Material } from '@babylonjs/core/Materials/material';
import { MmdStandardMaterial } from 'babylon-mmd';
import {
  applyGlobals,
  DEFAULT_NPR_SETTINGS,
  featuresFor,
  isHeavy,
  lookCost,
  resolveLook,
  type LookParams,
  type ModelLooks,
  type NprSettings,
  type Tier,
} from '@/lib/npr/looks';
import { NprLookPlugin } from './NprLookPlugin';

interface Saved {
  transparencyMode: number | null;
  backFaceCulling: boolean;
}

export interface NprMaterialState {
  /** Outline thickness multiplier and colour override from the look. */
  outlineScale: number;
  outlineColor: [number, number, number] | null;
}

export interface NprStats {
  materials: number;
  heavy: number;
  /** Mean relative fragment cost of NPR materials (1 = Default). */
  cost: number;
  failed: string[];
  supported: boolean;
  tier: Tier;
}

/** Eye-ish materials (by name) get the see-through depth bias when the model option is on. */
const SEE_THROUGH = /目|瞳|白目|眉|まゆ|まつ|睫|ハイライト|eye|iris|pupil|brow|lash/i;

export class NprManager {
  private plugins = new WeakMap<Material, NprLookPlugin>();
  private saved = new WeakMap<Material, Saved>();
  private looks = new Map<string, ModelLooks>();
  private failed = new Set<string>();
  private stats = new Map<string, { n: number; heavy: number; cost: number }>();
  settings: NprSettings = { ...DEFAULT_NPR_SETTINGS };
  tier: Tier = 'high';
  /** Test hook: compile a broken variant for this look id. */
  breakLook: string | null = null;

  /** Called after a variant failed so every model re-applies (they share compiled effects). */
  onFailure: () => void = () => undefined;

  constructor(
    readonly supported: boolean,
    private readonly warn: (msg: string) => void,
  ) {}

  getLooks(modelId: string): ModelLooks | null {
    return this.looks.get(modelId) ?? null;
  }

  setLooks(modelId: string, looks: ModelLooks | null): void {
    if (looks) this.looks.set(modelId, structuredClone(looks));
    else this.looks.delete(modelId);
  }

  forget(modelId: string): void {
    this.looks.delete(modelId);
    this.stats.delete(modelId);
  }

  /**
   * Apply the model's looks to its materials. Returns per-material outline overrides (by material index).
   * `heightScale` scales the see-through bias with the model size.
   */
  apply(modelId: string, materials: readonly Material[], heightScale = 1): NprMaterialState[] {
    const looks = this.looks.get(modelId);
    const off = !this.supported || this.settings.showOriginal || !looks;
    let n = 0;
    let heavy = 0;
    let cost = 0;
    const out = materials.map((mat): NprMaterialState => {
      const name = mat.name;
      const look = off ? undefined : looks?.materials[name];
      const base = resolveLook(look);
      const p0 = base && applyGlobals(base, this.settings);
      const f0 = p0 && featuresFor(p0, this.tier);
      const variant = f0
        ? `${look!.look}:${this.tier}:${JSON.stringify(f0)}:${this.breakLook === look!.look}`
        : '';
      if (!(mat instanceof MmdStandardMaterial) || !base || this.failed.has(variant)) {
        this.detach(mat);
        return { outlineScale: 1, outlineColor: null };
      }
      const p: LookParams = p0!;
      const f = f0!;
      n++;
      cost += lookCost(f);
      if (isHeavy(f)) heavy++;
      let plugin = this.plugins.get(mat);
      if (!plugin) {
        plugin = new NprLookPlugin(mat);
        this.plugins.set(mat, plugin);
        this.saved.set(mat, { transparencyMode: mat.transparencyMode, backFaceCulling: mat.backFaceCulling });
      }
      mat.onError = () => {
        if (this.failed.has(variant)) return;
        this.failed.add(variant);
        this.warn(
          `The ${look?.look ?? 'NPR'} look couldn't be compiled (${this.tier} quality) — showing the PMX original for those materials.`,
        );
        this.onFailure();
      };
      const seeThrough =
        !!looks?.seeThroughEyes &&
        SEE_THROUGH.test(name) &&
        (look?.look === 'eye' || look?.look === 'animeFace');
      plugin.setLook(p, f, {
        tierHigh: this.tier === 'high',
        seeThrough,
        seeThroughBias: 0.9 * heightScale,
        broken: this.breakLook === look?.look,
      });
      const saved = this.saved.get(mat)!;
      mat.transparencyMode =
        f.alpha === 'hash' || f.alpha === 'mask'
          ? Material.MATERIAL_OPAQUE
          : f.alpha === 'blend'
            ? Material.MATERIAL_ALPHABLEND
            : saved.transparencyMode;
      return { outlineScale: p.outlineScale, outlineColor: p.outlineColor };
    });
    this.stats.set(modelId, { n, heavy, cost });
    return out;
  }

  private detach(mat: Material): void {
    const plugin = this.plugins.get(mat);
    if (!plugin?.active) return;
    plugin.setLook(null, null, { tierHigh: false, seeThrough: false, seeThroughBias: 0 });
    this.restore(mat);
  }

  private restore(mat: Material): void {
    const s = this.saved.get(mat);
    if (s) {
      mat.transparencyMode = s.transparencyMode;
      mat.backFaceCulling = s.backFaceCulling;
    }
  }

  /** Forget compile failures (a new tier or edited look may compile). */
  clearFailures(): void {
    this.failed.clear();
  }

  getStats(): NprStats {
    let materials = 0;
    let heavy = 0;
    let cost = 0;
    for (const s of this.stats.values()) {
      materials += s.n;
      heavy += s.heavy;
      cost += s.cost;
    }
    return {
      materials,
      heavy,
      cost: materials ? cost / materials : 1,
      failed: [...this.failed].map((v) => v.split(':')[0]),
      supported: this.supported,
      tier: this.tier,
    };
  }
}

/** Outline thickness factor for a camera distance (thinner far away so silhouettes don't turn into blobs). */
export function outlineFalloff(distance: number, reference: number): number {
  if (!(distance > 0)) return 1;
  return Math.max(0.35, Math.min(1, Math.sqrt(reference / distance)));
}
