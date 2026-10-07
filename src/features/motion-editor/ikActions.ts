// IK-aware editing: IK → FK bake, FK → IK fit, foot pins. The runtime (babylon-mmd's solver) does the
// solving; these turn its results into keys and verify there are no pops.

import { sampleBone } from '@/lib/motion/evaluate';
import { setIkRange, writeDenseKeys } from '@/lib/motion/ik';
import { reduce } from '@/lib/motion/tools';
import type { PinRange, Vec3 } from '@/lib/motion/types';
import { engineOrNull } from '@/store/engineRef';
import { me } from '@/store/motionEditor';
import { toast } from '@/store/studio';
import { commitClips, newId, scheduleApply, setPins } from './actions';

export interface IkChain {
  bone: string;
  target: string;
  links: string[];
}

export function ikChains(): IkChain[] {
  const id = me.get().modelId;
  return id ? (engineOrNull()?.getIkChains(id) ?? []) : [];
}

const frameList = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let f = Math.max(0, Math.round(from)); f <= Math.round(to); f++) out.push(f);
  return out;
};

const maxDist = (a: Record<string, Vec3>[], b: Record<string, Vec3>[], names: string[]): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++)
    for (const n of names) {
      const p = a[i][n];
      const q = b[i]?.[n];
      if (p && q) m = Math.max(m, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    }
  return m;
};

export interface IkResult {
  /** Max target position error after the operation (model units). */
  error: number;
  frames: number;
}

/**
 * Bake IK → FK over [from, to]: write the solved link rotations every frame and switch the chains' IK
 * off for the range (restored after it). The pose is unchanged, so there's no pop.
 */
export function bakeIkToFk(
  bones: string[],
  from: number,
  to: number,
  opts: { reduceTol?: number } = {},
): IkResult | null {
  const engine = engineOrNull();
  const modelId = me.get().modelId;
  if (!engine || !modelId) return null;
  const chains = ikChains().filter((c) => bones.includes(c.bone));
  if (!chains.length) return null;
  scheduleApply(modelId, true);
  const frames = frameList(from, to);
  const links = [...new Set(chains.flatMap((c) => c.links))];
  const targets = chains.map((c) => c.target);
  const solved = engine.sampleModel(modelId, frames, [...links, ...targets], { ik: true });
  const keys: Record<string, { f: number; r: [number, number, number, number] }[]> = {};
  for (const l of links) keys[l] = frames.map((f, i) => ({ f, r: solved[i].r[l] }));
  const ok = commitClips('Bake IK → FK', (c) => {
    let out = setIkRange(
      writeDenseKeys(c, from, to, keys),
      chains.map((x) => x.bone),
      from,
      to,
      false,
    );
    if (opts.reduceTol)
      out = reduce(out, from, to, { pos: 0.001, rot: opts.reduceTol }, { bones: links, morphs: false });
    return out;
  });
  if (!ok) return null;
  scheduleApply(modelId, true);
  const after = engine.sampleModel(modelId, frames, targets);
  return {
    error: maxDist(
      solved.map((s) => s.pos),
      after.map((s) => s.pos),
      targets,
    ),
    frames: frames.length,
  };
}

/**
 * Fit IK from FK over [from, to]: key each IK bone on its chain target (as posed by FK) every frame and
 * switch IK on for the range. FK keys stay as the solver's starting pose, so knees don't flip.
 */
export function fitIkFromFk(
  bones: string[],
  from: number,
  to: number,
  opts: { reduceTol?: number } = {},
): IkResult | null {
  const engine = engineOrNull();
  const modelId = me.get().modelId;
  if (!engine || !modelId) return null;
  const chains = ikChains().filter((c) => bones.includes(c.bone));
  if (!chains.length) return null;
  scheduleApply(modelId, true);
  const frames = frameList(from, to);
  const targets = chains.map((c) => c.target);
  const fk = engine.sampleModel(modelId, frames, targets, { ik: false });
  const fits = engine.fitIkTargets(
    modelId,
    frames,
    chains.map((c) => c.bone),
  );
  const ok = commitClips('Fit IK from FK', (c) => {
    let out = setIkRange(
      writeDenseKeys(c, from, to, fits),
      chains.map((x) => x.bone),
      from,
      to,
      true,
    );
    if (opts.reduceTol)
      out = reduce(
        out,
        from,
        to,
        { pos: opts.reduceTol, rot: 0.5 },
        { bones: Object.keys(fits), morphs: false },
      );
    return out;
  });
  if (!ok) return null;
  scheduleApply(modelId, true);
  const after = engine.sampleModel(modelId, frames, targets, { ik: true });
  return {
    error: maxDist(
      fk.map((s) => s.pos),
      after.map((s) => s.pos),
      targets,
    ),
    frames: frames.length,
  };
}

/** Pin an IK bone over [from, to]: its value at `from` is held (blended in/out), feet stay planted. */
export function addPin(bone: string, from: number, to: number, blendIn = 3, blendOut = 3): void {
  const s = me.get();
  const modelId = s.modelId;
  const clip = modelId ? s.clips[modelId] : null;
  if (!modelId || !clip) return;
  const track = clip.bones.find((t) => t.name === bone);
  if (!track?.keys.length) {
    toast('warning', `${bone} has no keys to pin`);
    return;
  }
  const anchor = sampleBone(track.keys, from);
  const pin: PinRange = {
    id: newId('pin'),
    bone,
    start: from,
    end: Math.max(from, to),
    blendIn,
    blendOut,
    anchor,
  };
  setPins(modelId, [...(s.pins[modelId] ?? []), pin], `Pin ${bone}`);
}

export function removePin(id: string): void {
  const s = me.get();
  if (!s.modelId) return;
  setPins(
    s.modelId,
    (s.pins[s.modelId] ?? []).filter((p) => p.id !== id),
    'Remove pin',
  );
}

/** Re-capture a pin's anchor at its start frame (after editing the motion underneath). */
export function recapturePin(id: string): void {
  const s = me.get();
  const modelId = s.modelId;
  if (!modelId) return;
  const pins = s.pins[modelId] ?? [];
  const pin = pins.find((p) => p.id === id);
  const track = s.clips[modelId]?.bones.find((t) => t.name === pin?.bone);
  if (!pin || !track) return;
  const anchor = sampleBone(track.keys, pin.start);
  setPins(
    modelId,
    pins.map((p) => (p.id === id ? { ...p, anchor } : p)),
    'Re-anchor pin',
  );
}

/** Per-model IK solver toggle (debug / FK posing). */
export function setSolver(enabled: boolean): void {
  const s = me.get();
  if (!s.modelId) return;
  engineOrNull()?.setIkEnabled(s.modelId, enabled);
  me.set((st) => ({ ikOff: { ...st.ikOff, [s.modelId!]: !enabled } }));
}
