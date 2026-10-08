import { describe, expect, it } from 'vitest';
import { qdot } from '@/lib/math3d';
import { sampleBone, sampleCamera } from '@/lib/motion/evaluate';
import { makeClip } from '@/lib/motion/fixtures';
import { cutFrames } from '@/lib/motion/camera';
import { loop, mirror, retime, trim } from '@/lib/motion/tools';
import { emptyClip, linearCurves, type MotionClip, type Quat } from '@/lib/motion/types';
import { applyFace, bakeCamera, bakeDance, LOOP_SEAM, segment } from './bake';
import {
  addClip,
  deleteClips,
  duplicateClip,
  ensureTrack,
  moveClip,
  newClip,
  pasteClips,
  reorderClip,
  setLoop,
  setSpeed,
  splitClip,
  trackClips,
  trimClip,
} from './ops';
import { parseTimeline } from './serialize';
import { snapMove, snapPoint } from './snap';
import { cueFrames, parseLrc, parseSrt } from './subtitles';
import { clipEnd, clipLength, emptyTimeline, type Clip, type Source, type TimelineDoc } from './types';

const SRC_A: Source = { id: 'a', kind: 'motion', name: 'a.vmd', length: 120 };
const SRC_B: Source = { id: 'b', kind: 'motion', name: 'b.vmd', length: 120 };
const motionA = makeClip(1, { frames: 120, step: 10 });
const motionB = makeClip(2, { frames: 120, step: 10 });
const sources = new Map<string, MotionClip>([
  ['a', motionA],
  ['b', motionB],
]);
const get = (id: string) => sources.get(id);

const pose = (clip: MotionClip, bone: string, f: number) =>
  sampleBone(clip.bones.find((t) => t.name === bone)?.keys ?? [], f);
const angle = (a: Quat, b: Quat): number => 2 * Math.acos(Math.min(1, Math.abs(qdot(a, b))));
const dist = (a: number[], b: number[]): number => Math.hypot(...a.map((v, i) => v - b[i]));

function doc1(...clips: Partial<Clip>[]): { doc: TimelineDoc; trackId: string } {
  const { doc, track } = ensureTrack(emptyTimeline(), 'dance', 'm1');
  let d = doc;
  for (const c of clips) d = addClip(d, newClip(track.id, c.sourceId === 'b' ? SRC_B : SRC_A, 0, c));
  return { doc: d, trackId: track.id };
}

const bakeTrack = (d: TimelineDoc, trackId: string) => bakeDance(trackClips(d, trackId), get);

describe('segments equal the keyframe tools', () => {
  it('trim, mirror, retime, loop', () => {
    const base = newClip('t', SRC_A, 0, { sourceIn: 20, sourceOut: 80 });
    const seg = segment(motionA, base);
    const tr = trim(motionA, 20, 80);
    for (const f of [0, 13, 31, 60])
      expect(dist(pose(seg, 'センター', f).p, pose(tr, 'センター', f).p)).toBeLessThan(1e-6);
    const m = segment(motionA, { ...base, mirror: true });
    const mt = mirror(tr, { camera: true });
    for (const f of [5, 40]) expect(angle(pose(m, '右腕', f).r, pose(mt, '右腕', f).r)).toBeLessThan(1e-6);
    const fast = segment(motionA, { ...base, speed: 2 });
    const rt = retime(tr, 0, 60, 0.5, { camera: true });
    for (const f of [0, 10, 29])
      expect(angle(pose(fast, '上半身', f).r, pose(rt, '上半身', f).r)).toBeLessThan(1e-6);
    const lp = segment(motionA, { ...base, loopCount: 3 });
    const lt = loop(tr, 0, 60, 3, LOOP_SEAM);
    expect(Math.max(...lp.bones.flatMap((t) => t.keys.map((k) => k.f)))).toBe(180);
    for (const f of [70, 130, 175])
      expect(angle(pose(lp, '上半身', f).r, pose(lt, '上半身', f).r)).toBeLessThan(1e-6);
  });

  it('a single clip bakes to its segment at its start frame', () => {
    const { doc, trackId } = doc1({ startFrame: 30, sourceIn: 10, sourceOut: 70 });
    const baked = bakeTrack(doc, trackId);
    const tr = trim(motionA, 10, 70);
    for (const f of [0, 17, 45, 60]) {
      expect(dist(pose(baked, 'センター', 30 + f).p, pose(tr, 'センター', f).p)).toBeLessThan(1e-5);
      expect(angle(pose(baked, '左腕', 30 + f).r, pose(tr, '左腕', f).r)).toBeLessThan(1e-5);
    }
  });
});

describe('edit operations', () => {
  it('split keeps the pose continuous at the cut (any speed, loops)', () => {
    for (const extra of [{}, { speed: 1.5 }, { loopCount: 3, sourceOut: 40 }] as Partial<Clip>[]) {
      const { doc, trackId } = doc1({ startFrame: 10, ...extra });
      const id = doc.clips[0].id;
      const whole = bakeTrack(doc, trackId);
      for (const at of [37, 55]) {
        const { doc: d2, ids } = splitClip(doc, id, at);
        expect(ids.length).toBe(2);
        const split = bakeTrack(d2, trackId);
        const total = trackClips(d2, trackId).reduce((s, c) => s + clipLength(c), 0);
        expect(Math.abs(total - clipLength(doc.clips[0]))).toBeLessThanOrEqual(1);
        // Same motion as the unsplit clip (within half a source frame of timing at non-1 speeds) …
        for (const f of [at - 1, at, at + 1, at + 5]) {
          expect(
            dist(pose(split, 'センター', f).p, pose(whole, 'センター', f).p),
            `f${f} ${JSON.stringify(extra)}`,
          ).toBeLessThan(0.15);
          expect(angle(pose(split, '上半身', f).r, pose(whole, '上半身', f).r)).toBeLessThan(0.05);
        }
        // … and no jump at the cut: the step there is no bigger than the motion's own steps.
        const step = (c: MotionClip, f: number) =>
          dist(pose(c, 'センター', f).p, pose(c, 'センター', f - 1).p);
        const maxStep = Math.max(...Array.from({ length: 20 }, (_, i) => step(whole, at - 10 + i)));
        expect(step(split, at)).toBeLessThanOrEqual(maxStep * 1.6 + 1e-6);
      }
    }
  });

  it('trim, move, duplicate, reorder, delete, paste', () => {
    const { doc, trackId } = doc1({ startFrame: 0 }, { sourceId: 'b', startFrame: 120 });
    const [a, b] = trackClips(doc, trackId);
    const t1 = trimClip(doc, a.id, 'start', 20);
    const a1 = trackClips(t1, trackId)[0];
    expect([a1.startFrame, a1.sourceIn, clipEnd(a1)]).toEqual([20, 20, 120]);
    const t2 = trimClip(doc, a.id, 'end', 90, 120);
    expect(clipEnd(trackClips(t2, trackId)[0])).toBe(90);
    const m = moveClip(doc, b.id, 200);
    expect(trackClips(m, trackId)[1].startFrame).toBe(200);
    const { doc: dup, id } = duplicateClip(doc, a.id);
    const after = trackClips(dup, trackId);
    expect(after.map((c) => c.startFrame)).toEqual([0, 120, 240]);
    expect(after[1].id).toBe(id);
    const r = reorderClip(doc, b.id, 0);
    expect(trackClips(r, trackId).map((c) => [c.sourceId, c.startFrame])).toEqual([
      ['b', 0],
      ['a', 120],
    ]);
    expect(deleteClips(doc, [a.id]).clips.length).toBe(1);
    const { doc: p, ids } = pasteClips(doc, [a, b], 300);
    expect(ids.length).toBe(2);
    expect(
      trackClips(p, trackId)
        .slice(-2)
        .map((c) => c.startFrame),
    ).toEqual([300, 420]);
    // Immutability.
    expect(doc.clips[0]).toBe(a);
  });

  it('retime and loop change the length', () => {
    const { doc } = doc1({ sourceOut: 60 });
    const id = doc.clips[0].id;
    expect(clipLength(setSpeed(doc, id, 2).clips[0])).toBe(30);
    expect(clipLength(setSpeed(doc, id, 10).clips[0])).toBe(15);
    expect(clipLength(setLoop(doc, id, 3).clips[0])).toBe(180);
  });
});

describe('joins', () => {
  it('overlapping clips crossfade (slerp) over the overlap', () => {
    const { doc, trackId } = doc1(
      { startFrame: 0, sourceOut: 60, join: { fade: 0, root: 'origin', cut: true } },
      { sourceId: 'b', startFrame: 40, sourceOut: 60, join: { fade: 0, root: 'origin', cut: true } },
    );
    const baked = bakeTrack(doc, trackId);
    const a = segment(motionA, trackClips(doc, trackId)[0]);
    const b = segment(motionB, trackClips(doc, trackId)[1]);
    // Before / after the overlap: exactly each clip.
    expect(angle(pose(baked, '上半身', 30).r, pose(a, '上半身', 30).r)).toBeLessThan(1e-5);
    expect(angle(pose(baked, '上半身', 80).r, pose(b, '上半身', 40).r)).toBeLessThan(1e-5);
    // Middle of the overlap: between the two.
    const mid = pose(baked, '上半身', 50).r;
    const pa = pose(a, '上半身', 50).r;
    const pb = pose(b, '上半身', 10).r;
    expect(angle(mid, pa) + angle(mid, pb)).toBeCloseTo(angle(pa, pb), 3);
    // No pops: per-frame change bounded.
    for (let f = 1; f < 100; f++)
      expect(angle(pose(baked, '上半身', f).r, pose(baked, '上半身', f - 1).r)).toBeLessThan(0.15);
  });

  it('adjacent clips crossfade over join.fade frames using the handle', () => {
    const { doc, trackId } = doc1(
      { startFrame: 0, sourceOut: 50 },
      { sourceId: 'b', startFrame: 50, sourceOut: 60, join: { fade: 8, root: 'origin', cut: true } },
    );
    const baked = bakeTrack(doc, trackId);
    for (let f = 45; f < 62; f++)
      expect(angle(pose(baked, '右腕', f).r, pose(baked, '右腕', f - 1).r)).toBeLessThan(0.15);
    const b = segment(motionB, trackClips(doc, trackId)[1]);
    expect(angle(pose(baked, '右腕', 60).r, pose(b, '右腕', 10).r)).toBeLessThan(1e-5);
  });

  it('root continuity: the next clip starts where the previous ended (feet follow)', () => {
    // A walks +X; B starts at the origin.
    const walk = (dx: number): MotionClip => ({
      ...emptyClip(),
      bones: [
        {
          name: 'センター',
          keys: [0, 60].map((f) => ({
            f,
            p: [f * dx, 0, 0] as [number, number, number],
            r: [0, 0, 0, 1] as Quat,
            ip: linearCurves(4),
          })),
        },
        {
          name: '左足ＩＫ',
          keys: [0, 60].map((f) => ({
            f,
            p: [f * dx + 1, 0, 0] as [number, number, number],
            r: [0, 0, 0, 1] as Quat,
            ip: linearCurves(4),
          })),
        },
      ],
    });
    sources.set('w', walk(0.1));
    const S: Source = { id: 'w', kind: 'motion', name: 'w', length: 60 };
    const { doc, track } = ensureTrack(emptyTimeline(), 'dance', 'm1');
    let d = addClip(doc, newClip(track.id, S, 0));
    d = addClip(d, newClip(track.id, S, 60, { join: { fade: 0, root: 'continue', cut: true } }));
    const baked = bakeTrack(d, track.id);
    expect(pose(baked, 'センター', 60).p[0]).toBeCloseTo(6, 3);
    expect(pose(baked, 'センター', 61).p[0]).toBeCloseTo(6.1, 3);
    expect(pose(baked, '左足ＩＫ', 61).p[0]).toBeCloseTo(7.1, 3);
    // Origin mode jumps back.
    const o = addClip(
      addClip(doc, newClip(track.id, S, 0)),
      newClip(track.id, S, 60, { join: { fade: 0, root: 'origin', cut: true } }),
    );
    expect(pose(bakeTrack(o, track.id), 'センター', 61).p[0]).toBeCloseTo(0.1, 3);
    // Duplicates (and new clips) repeat in place: no drift copy after copy.
    let dup = addClip(doc, newClip(track.id, S, 0));
    const firstId = trackClips(dup, track.id)[0].id;
    dup = duplicateClip(dup, firstId).doc;
    dup = duplicateClip(dup, firstId).doc;
    const rep = bakeTrack(dup, track.id);
    for (const f of [30, 90, 150]) expect(pose(rep, 'センター', f).p[0]).toBeCloseTo(3, 3);
  });

  it('camera joins: hard cuts are MMD cut pairs, blends have none', () => {
    const S: Source = { id: 'a', kind: 'camera', name: 'cam', length: 120 };
    const { doc, track } = ensureTrack(emptyTimeline(), 'camera');
    let d = addClip(doc, newClip(track.id, S, 0, { sourceOut: 60 }));
    d = addClip(d, newClip(track.id, S, 60, { sourceIn: 60, sourceOut: 120 }));
    const cut = bakeCamera(trackClips(d, track.id), get);
    expect(cutFrames(cut.camera)).toContain(60);
    const second = trackClips(d, track.id)[1].id;
    const blended = bakeCamera(
      trackClips(
        {
          ...d,
          clips: d.clips.map((c) =>
            c.id === second ? { ...c, join: { ...c.join, cut: false, fade: 10 } } : c,
          ),
        },
        track.id,
      ),
      get,
    );
    expect(cutFrames(blended.camera).filter((f) => f >= 55 && f <= 75)).toEqual([]);
    expect(sampleCamera(blended.camera, 100).d).toBeCloseTo(sampleCamera(motionA.camera, 100).d, 3);
  });

  it('face clips override dance morphs inside their range', () => {
    const base = {
      ...emptyClip(),
      morphs: [
        {
          name: 'まばたき',
          keys: [
            { f: 0, w: 0.2 },
            { f: 100, w: 0.2 },
          ],
        },
      ],
    };
    const face = {
      ...emptyClip(),
      morphs: [
        {
          name: 'まばたき',
          keys: [
            { f: 0, w: 1 },
            { f: 100, w: 1 },
          ],
        },
      ],
    };
    const out = applyFace(base, face, [[30, 50]]);
    const m = out.morphs[0];
    const at = (f: number) => {
      const k = m.keys.filter((x) => x.f <= f).pop()!;
      return k.w;
    };
    expect(at(40)).toBe(1);
    expect(at(20)).toBeCloseTo(0.2);
    expect(at(80)).toBeCloseTo(0.2);
  });
});

describe('snapping', () => {
  const clips = [newClip('t', SRC_A, 100, { sourceOut: 50 })];
  it('snaps to the playhead, clip edges, markers and beats', () => {
    expect(snapPoint(98, { playhead: 300, clips, radius: 4 }).frame).toBe(100);
    expect(snapPoint(152, { clips, radius: 4 }).frame).toBe(150);
    expect(snapPoint(297, { playhead: 300, radius: 4 }).frame).toBe(300);
    expect(snapPoint(62, { markers: [60], radius: 4 }).frame).toBe(60);
    expect(snapPoint(44, { grid: { bpm: 120, offset: 0, beatsPerBar: 4 }, radius: 2 }).frame).toBe(45);
    expect(snapPoint(52, { radius: 2 }).snapped).toBe(false);
    // A moving clip's end edge can snap.
    expect(snapMove(42, 60, { clips, radius: 3 }).start).toBe(40);
  });
});

describe('serialization', () => {
  it('round-trips a timeline and drops malformed entries', () => {
    const { doc } = doc1({ startFrame: 5, mirror: true, speed: 1.5, loopCount: 2 });
    const full: TimelineDoc = { ...doc, sources: [SRC_A, { ...SRC_B, ref: { blobId: 'x', path: 'b.vmd' } }] };
    expect(parseTimeline(JSON.parse(JSON.stringify(full)))).toEqual(full);
    const bad = parseTimeline({
      tracks: [{ id: 't1', kind: 'dance' }, { id: 7 }],
      sources: [{ id: 's', kind: 'nope' }],
      clips: [
        { id: 'c', trackId: 'missing' },
        { id: 'd', trackId: 't1', sourceId: 'gone' },
        { id: 'e', trackId: 't1', text: { content: 'hi', size: 'big' } },
      ],
    })!;
    expect(bad.tracks.length).toBe(1);
    expect(bad.sources).toEqual([]);
    expect(bad.clips.map((c) => c.id)).toEqual(['e']);
    expect(bad.clips[0].text!.content).toBe('hi');
    expect(typeof bad.clips[0].text!.size).toBe('number');
  });
});

describe('subtitles', () => {
  it('parses SRT', () => {
    const cues = parseSrt(
      '1\n00:00:01,000 --> 00:00:02,500\nHello <i>world</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nこんにちは\n二行目\n',
    );
    expect(cues).toEqual([
      { start: 1, end: 2.5, text: 'Hello world' },
      { start: 3, end: 4, text: 'こんにちは\n二行目' },
    ]);
    expect(cueFrames(cues[0])).toEqual({ start: 30, length: 45 });
  });
  it('parses LRC with multiple tags and offset', () => {
    const cues = parseLrc('[ti:Song]\n[offset:+500]\n[00:01.00][00:05.00]La la\n[00:03.50]Hey\n');
    expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [0.5, 3, 'La la'],
      [3, 4.5, 'Hey'],
      [4.5, 8.5, 'La la'],
    ]);
  });
});
