import { boneGroup, GROUP_LABEL, GROUP_ORDER, type BoneGroup } from '@/lib/motion/edit';
import { CAMERA_TRACK, type KeyRef, type MotionClip, type PinRange } from '@/lib/motion/types';

export type GroupId = BoneGroup | 'morph' | 'camera';

export type Row =
  | { type: 'group'; id: GroupId; label: string; count: number; collapsed: boolean; frames: number[] }
  | {
      type: 'track';
      kind: KeyRef['kind'];
      track: string;
      label: string;
      group: GroupId;
      frames: number[];
      pins?: PinRange[];
    };

export const GROUP_COLOR: Record<GroupId, string> = {
  center: '#f5b84a',
  upper: '#6d8bff',
  arms: '#4fc3f7',
  legs: '#81c784',
  ik: '#ff8a65',
  fingers: '#b0bec5',
  other: '#9e9e9e',
  morph: '#f06292',
  camera: '#ffd54f',
};

const framesOf = <T extends { f: number }>(keys: readonly T[]): number[] => keys.map((k) => k.f);

/** Merge sorted frame lists. */
function union(lists: number[][]): number[] {
  const s = new Set<number>();
  for (const l of lists) for (const f of l) s.add(f);
  return [...s].sort((a, b) => a - b);
}

/** Rows for the dope sheet: groups (collapsible) with their tracks, morphs, then the camera. */
export function buildRows(
  clip: MotionClip | null,
  camera: MotionClip | null,
  collapsed: Record<string, boolean>,
  pins: readonly PinRange[] = [],
  showCamera = true,
): Row[] {
  const tracks = new Map<GroupId, Row[]>();
  const push = (g: GroupId, r: Row): void => {
    const list = tracks.get(g) ?? [];
    list.push(r);
    tracks.set(g, list);
  };
  if (clip) {
    for (const t of clip.bones) {
      if (!t.keys.length) continue;
      const g = boneGroup(t.name);
      const p = pins.filter((x) => x.bone === t.name);
      push(g, {
        type: 'track',
        kind: 'bone',
        track: t.name,
        label: t.name,
        group: g,
        frames: framesOf(t.keys),
        pins: p.length ? p : undefined,
      });
    }
    // Pinned IK bones without keys still show their row.
    for (const p of pins) {
      if (!clip.bones.some((t) => t.name === p.bone && t.keys.length)) {
        push('ik', {
          type: 'track',
          kind: 'bone',
          track: p.bone,
          label: p.bone,
          group: 'ik',
          frames: [],
          pins: pins.filter((x) => x.bone === p.bone),
        });
      }
    }
    for (const t of clip.morphs) {
      if (!t.keys.length) continue;
      push('morph', {
        type: 'track',
        kind: 'morph',
        track: t.name,
        label: t.name,
        group: 'morph',
        frames: framesOf(t.keys),
      });
    }
  }
  if (showCamera && camera) {
    push('camera', {
      type: 'track',
      kind: 'camera',
      track: CAMERA_TRACK,
      label: 'Camera',
      group: 'camera',
      frames: framesOf(camera.camera),
    });
  }
  const out: Row[] = [];
  for (const g of GROUP_ORDER) {
    const list = tracks.get(g);
    if (!list?.length) continue;
    const seen = new Set<string>();
    const unique = list.filter((r) => r.type === 'track' && !seen.has(r.track) && seen.add(r.track));
    const isCollapsed = !!collapsed[g];
    out.push({
      type: 'group',
      id: g,
      label: GROUP_LABEL[g],
      count: unique.length,
      collapsed: isCollapsed,
      frames: union(unique.map((r) => (r.type === 'track' ? r.frames : []))),
    });
    if (!isCollapsed) out.push(...unique);
  }
  return out;
}
