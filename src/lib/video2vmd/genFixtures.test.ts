// Writes the Video → VMD v2 e2e model (run with GEN_FIXTURES=1): the converter's procedural VRM humanoid
// (full fingers, eyes, 手捩) as a PMX, plus the standard face morphs the face tracker drives. Original
// procedural content only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { makeHumanoid } from '@/lib/convert/fixture';
import { parseGltf } from '@/lib/convert/gltf';
import { convertModel } from '@/lib/convert/pipeline';
import type { PmxMorph } from '@/lib/convert/pmx/types';
import { writePmx } from '@/lib/convert/pmx/writer';

const OUT = join(__dirname, '../../../e2e/fixtures/FaceHands');

it.skipIf(!process.env.GEN_FIXTURES)('generate the face + hands PMX fixture', () => {
  const src = parseGltf(makeHumanoid({ style: 'vrm', vrm: 1, name: 'FaceHands' }).bytes);
  const r = convertModel(src);
  const pmx = r.pmx;
  pmx.name = 'フェイスハンズ';
  pmx.nameEn = 'FaceHands';
  const base = pmx.morphs.find((m) => m.name === 'あ' && m.kind === 'vertex') as Extract<
    PmxMorph,
    { kind: 'vertex' }
  >;
  const blink = pmx.morphs.find((m) => m.name === 'まばたき' && m.kind === 'vertex') as Extract<
    PmxMorph,
    { kind: 'vertex' }
  >;
  const add = (name: string, nameEn: string, from: typeof base, scale: number, panel: PmxMorph['panel']) => {
    if (pmx.morphs.some((m) => m.name === name)) return;
    pmx.morphs.push({
      kind: 'vertex',
      name,
      nameEn,
      panel,
      offsets: from.offsets.map((o) => ({
        vertex: o.vertex,
        offset: [o.offset[0] * scale, o.offset[1] * scale, o.offset[2] * scale],
      })),
    });
  };
  add('い', 'i', base, 0.3, 3);
  add('う', 'u', base, 0.45, 3);
  add('え', 'e', base, 0.6, 3);
  add('お', 'o', base, 0.8, 3);
  add('ん', 'n', base, -0.2, 3);
  add('ウィンク', 'wink', blink, 1, 2);
  add('笑い', 'smile', blink, 0.5, 2);
  add('びっくり', 'surprised', blink, -0.6, 2);
  add('怒り', 'angry', blink, 0.2, 1);
  add('困る', 'troubled', blink, -0.2, 1);
  add('上', 'up', blink, -0.4, 1);
  const face = pmx.frames.find((f) => f.items.some((i) => i.kind === 'morph'));
  if (face) face.items = pmx.morphs.map((_, i) => ({ kind: 'morph' as const, index: i }));
  mkdirSync(join(OUT, 'tex'), { recursive: true });
  writeFileSync(join(OUT, 'facehands.pmx'), new Uint8Array(writePmx(pmx)));
  for (const t of r.textures) writeFileSync(join(OUT, t.path), r.model.textures[t.source].data);
});
