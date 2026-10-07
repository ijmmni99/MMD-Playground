import { describe, expect, it } from 'vitest';
import {
  allKeyRefs,
  boneGroup,
  copyKeys,
  deleteKeys,
  moveKeys,
  pasteKeys,
  setBoneKey,
  setMorphKey,
} from './edit';
import { makeClip } from './fixtures';
import { beatFrames, bpmFromTaps, framesPerBeat, snapFrame } from './timing';
import type { KeyRef } from './types';

const ref = (track: string, f: number, kind: KeyRef['kind'] = 'bone'): KeyRef => ({ kind, track, f });

describe('key edits', () => {
  it('inserts and updates keys in order without touching other tracks', () => {
    const clip = makeClip(1);
    const out = setBoneKey(clip, '上半身', { f: 5, p: [0, 0, 0], r: [0, 0, 0, 1] });
    const t = out.bones.find((b) => b.name === '上半身')!;
    expect(t.keys.map((k) => k.f).slice(0, 3)).toEqual([0, 5, 10]);
    expect(out.bones.find((b) => b.name === 'センター')).toBe(clip.bones.find((b) => b.name === 'センター'));
    const again = setBoneKey(out, '上半身', { f: 5, p: [1, 0, 0], r: [0, 0, 0, 1] });
    expect(again.bones.find((b) => b.name === '上半身')!.keys.filter((k) => k.f === 5)).toHaveLength(1);
  });

  it('moves keys in time, overwriting at the destination; alt-copy keeps originals', () => {
    const clip = makeClip(1);
    const moved = moveKeys(clip, [ref('センター', 10)], 10);
    const frames = moved.clip.bones.find((b) => b.name === 'センター')!.keys.map((k) => k.f);
    expect(frames).not.toContain(10);
    expect(frames.filter((f) => f === 20)).toHaveLength(1);
    expect(moved.refs).toEqual([ref('センター', 20)]);
    const copied = moveKeys(clip, [ref('センター', 10)], 5, { copy: true });
    const cf = copied.clip.bones.find((b) => b.name === 'センター')!.keys.map((k) => k.f);
    expect(cf).toContain(10);
    expect(cf).toContain(15);
  });

  it('never moves keys before frame 0', () => {
    const out = moveKeys(makeClip(1), [ref('センター', 0), ref('センター', 10)], -5);
    expect(out.refs.map((r) => r.f)).toEqual([0, 10]);
  });

  it('copies and pastes at the playhead with relative timing', () => {
    const clip = makeClip(1);
    const cb = copyKeys(clip, [ref('左腕', 10), ref('左腕', 20), ref('まばたき', 30, 'morph')])!;
    expect(cb.span).toBe(20);
    const { clip: out, refs } = pasteKeys(clip, cb, 200);
    expect(refs.map((r) => r.f).sort()).toEqual([200, 210, 220]);
    expect(out.morphs.find((m) => m.name === 'まばたき')!.keys.some((k) => k.f === 220)).toBe(true);
  });

  it('deletes keys and drops empty tracks', () => {
    const clip = setMorphKey(makeClip(1), '笑い', 3, 1);
    const out = deleteKeys(clip, [ref('笑い', 3, 'morph')]);
    expect(out.morphs.find((m) => m.name === '笑い')).toBeUndefined();
    expect(allKeyRefs(out).length).toBe(allKeyRefs(clip).length - 1);
  });

  it('classifies bones into dope-sheet groups', () => {
    expect(boneGroup('センター')).toBe('center');
    expect(boneGroup('左足ＩＫ')).toBe('ik');
    expect(boneGroup('右ひじ')).toBe('arms');
    expect(boneGroup('左ひざ')).toBe('legs');
    expect(boneGroup('頭')).toBe('upper');
    expect(boneGroup('左人指１')).toBe('fingers');
  });
});

describe('timing and snapping', () => {
  it('converts BPM to frames and builds a beat grid with bars', () => {
    expect(framesPerBeat(120)).toBe(15);
    const beats = beatFrames({ bpm: 120, offset: 3, beatsPerBar: 4 }, 0, 63);
    expect(beats.map((b) => b.f)).toEqual([3, 18, 33, 48, 63]);
    expect(beats.map((b) => b.bar)).toEqual([true, false, false, false, true]);
  });

  it('snaps to whole frames, beats and markers within a radius', () => {
    expect(snapFrame(10.6)).toBe(11);
    expect(snapFrame(-3)).toBe(0);
    const grid = { bpm: 120, offset: 0, beatsPerBar: 4 };
    expect(snapFrame(13.2, { grid, radius: 3 })).toBe(15);
    expect(snapFrame(9, { grid, radius: 3 })).toBe(9);
    expect(snapFrame(41, { grid, markers: [{ id: 'm', f: 42, name: 'drop' }], radius: 3 })).toBe(42);
  });

  it('estimates BPM from taps', () => {
    const taps = Array.from({ length: 8 }, (_, i) => i * 500);
    expect(bpmFromTaps(taps)).toBe(120);
  });
});
