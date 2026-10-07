import { describe, expect, it } from 'vitest';
import { makeClip } from '@/lib/motion/fixtures';
import { writeVmd } from '@/lib/motion/vmd';
import { buildMmdAnimation } from './buildAnimation';

describe('buildMmdAnimation', () => {
  it('builds the same tracks the VMD loader does', async () => {
    const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine');
    const { Scene } = await import('@babylonjs/core/scene');
    const { VmdLoader } = await import('babylon-mmd/esm/Loader/vmdLoader');
    const scene = new Scene(new NullEngine());
    const loader = new VmdLoader(scene);
    loader.loggingEnabled = false;
    const clip = makeClip(21, { randomCurves: true });
    const loaded = await loader.loadFromBufferAsync('a', writeVmd(clip));
    const built = buildMmdAnimation('a', clip, 'model');
    const byName = <T extends { name: string }>(a: readonly T[]) =>
      [...a].sort((x, y) => (x.name < y.name ? -1 : 1));
    const fields = [
      'frameNumbers',
      'rotations',
      'rotationInterpolations',
      'physicsToggles',
      'positions',
      'positionInterpolations',
    ] as const;
    for (const kind of ['boneTracks', 'movableBoneTracks'] as const) {
      const a = byName(loaded[kind] as readonly { name: string }[]);
      const b = byName(built[kind] as readonly { name: string }[]);
      expect(b.map((t) => t.name)).toEqual(a.map((t) => t.name));
      a.forEach((t, i) => {
        for (const f of fields) {
          const x = (t as unknown as Record<string, ArrayLike<number> | undefined>)[f];
          if (x)
            expect(Array.from((b[i] as unknown as Record<string, ArrayLike<number>>)[f])).toEqual(
              Array.from(x),
            );
        }
      });
    }
    const morphA = byName(loaded.morphTracks);
    const morphB = byName(built.morphTracks);
    expect(morphB.map((t) => Array.from(t.weights))).toEqual(morphA.map((t) => Array.from(t.weights)));
    expect(built.propertyTrack.ikBoneNames).toEqual(loaded.propertyTrack.ikBoneNames);
    for (let j = 0; j < built.propertyTrack.ikBoneNames.length; j++)
      expect(Array.from(built.propertyTrack.getIkState(j))).toEqual(
        Array.from(loaded.propertyTrack.getIkState(j)),
      );

    const cam = buildMmdAnimation('c', clip, 'camera').cameraTrack;
    for (const f of [
      'frameNumbers',
      'positions',
      'positionInterpolations',
      'rotations',
      'rotationInterpolations',
      'distances',
      'distanceInterpolations',
      'fovs',
      'fovInterpolations',
    ] as const)
      expect(Array.from(cam[f])).toEqual(Array.from(loaded.cameraTrack[f]));
    expect(built.endFrame).toBe(loaded.endFrame);
    scene.dispose();
  });

  it('reuses unchanged tracks (incremental rebuild)', () => {
    const clip = makeClip(2);
    const a = buildMmdAnimation('a', clip, 'model');
    const edited = { ...clip, bones: clip.bones.map((t, i) => (i === 0 ? { ...t, keys: [...t.keys] } : t)) };
    const b = buildMmdAnimation('b', edited, 'model');
    const all = (x: typeof a) => [...x.boneTracks, ...x.movableBoneTracks];
    const shared = all(b).filter((t) => all(a).includes(t));
    expect(shared.length).toBe(clip.bones.length - 1);
  });
});
