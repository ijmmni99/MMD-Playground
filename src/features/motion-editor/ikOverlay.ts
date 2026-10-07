// Viewport overlay for IK editing: chains, targets, knee (pole) direction, the ghost of a dragged IK
// target's original position, and pinned targets. Drawn as engine overlay lines while enabled.

import { pinWeight } from '@/lib/motion/ik';
import { engineOrNull } from '@/store/engineRef';
import { me, useMotionEditor } from '@/store/motionEditor';
import { studio } from '@/store/studio';

type V = [number, number, number];
type Seg = { a: V; b: V; color: V };

const ORANGE: V = [1, 0.55, 0.2];
const GREEN: V = [0.45, 0.9, 0.5];
const YELLOW: V = [1, 0.85, 0.3];
const PURPLE: V = [0.75, 0.5, 1];
const GREY: V = [0.6, 0.6, 0.65];
const CYAN: V = [0.3, 0.85, 1];

function cross(out: Seg[], p: V, s: number, color: V): void {
  out.push({ a: [p[0] - s, p[1], p[2]], b: [p[0] + s, p[1], p[2]], color });
  out.push({ a: [p[0], p[1] - s, p[2]], b: [p[0], p[1] + s, p[2]], color });
  out.push({ a: [p[0], p[1], p[2] - s], b: [p[0], p[1], p[2] + s], color });
}

function square(out: Seg[], p: V, s: number, color: V): void {
  const c: V[] = [
    [p[0] - s, p[1], p[2] - s],
    [p[0] + s, p[1], p[2] - s],
    [p[0] + s, p[1], p[2] + s],
    [p[0] - s, p[1], p[2] + s],
  ];
  for (let i = 0; i < 4; i++) out.push({ a: c[i], b: c[(i + 1) % 4], color });
}

let stop: (() => void) | null = null;
let ghost: { bone: string; frame: number; p: V } | null = null;

function frameSegments(): Seg[] {
  const engine = engineOrNull();
  const s = me.get();
  const modelId = s.modelId;
  if (!engine || !modelId) return [];
  const pos = engine.getBoneWorldPositions(modelId);
  if (!pos) return [];
  const chains = engine.getIkChains(modelId);
  const out: Seg[] = [];
  const size = 0.35;
  for (const c of chains) {
    const ik = pos[c.bone];
    const target = pos[c.target];
    if (!ik || !target) continue;
    const pts = [target, ...c.links.map((l) => pos[l]).filter(Boolean)];
    for (let i = 1; i < pts.length; i++) out.push({ a: pts[i - 1], b: pts[i], color: GREEN });
    cross(out, ik, size, ORANGE);
    out.push({ a: ik, b: target, color: YELLOW });
    // Pole: the knee/elbow bend direction (away from the hip–target line).
    if (c.links.length >= 2) {
      const knee = pos[c.links[0]];
      const root = pos[c.links[c.links.length - 1]];
      if (knee && root) {
        const mid: V = [(root[0] + target[0]) / 2, (root[1] + target[1]) / 2, (root[2] + target[2]) / 2];
        const d: V = [knee[0] - mid[0], knee[1] - mid[1], knee[2] - mid[2]];
        const len = Math.hypot(...d);
        if (len > 1e-4)
          out.push({
            a: knee,
            b: [knee[0] + (d[0] / len) * 1.2, knee[1] + (d[1] / len) * 1.2, knee[2] + (d[2] / len) * 1.2],
            color: PURPLE,
          });
      }
    }
  }
  // Ghost of the selected IK bone's position before the current edit.
  const st = studio.get();
  const frame = Math.round(engine.getPlayback().frame);
  const selName =
    st.selectedModelId === modelId && st.selectedBone !== null
      ? st.models.find((m) => m.id === modelId)?.info.bones[st.selectedBone]?.name
      : undefined;
  const isIk = selName && chains.some((c) => c.bone === selName);
  if (!isIk) ghost = null;
  else if (!ghost || ghost.bone !== selName || ghost.frame !== frame || engine.getPlayback().playing)
    ghost = { bone: selName, frame, p: pos[selName] };
  else {
    const cur = pos[selName];
    if (Math.hypot(cur[0] - ghost.p[0], cur[1] - ghost.p[1], cur[2] - ghost.p[2]) > 1e-3) {
      cross(out, ghost.p, size * 0.8, GREY);
      out.push({ a: ghost.p, b: cur, color: GREY });
    }
  }
  // Pins active at this frame.
  for (const p of s.pins[modelId] ?? []) {
    const w = pinWeight(p, frame);
    if (w > 0 && pos[p.bone]) square(out, pos[p.bone], 0.6 * Math.max(0.4, w), CYAN);
  }
  return out;
}

/** Start/stop the overlay to match the editor state. */
export function syncIkOverlay(): void {
  const s = me.get();
  const want = s.open && s.ikOverlay && !!s.modelId;
  const engine = engineOrNull();
  if (want && !stop && engine) {
    const off = engine.onBeforeFrame(() => engine.setOverlayLines('ik', frameSegments()));
    stop = () => {
      off();
      engine.setOverlayLines('ik', null);
      ghost = null;
    };
  } else if (!want && stop) {
    stop();
    stop = null;
  }
}

useMotionEditor.subscribe(syncIkOverlay);
