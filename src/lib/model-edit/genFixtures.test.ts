// Writes the Model Editor e2e models (run with GEN_FIXTURES=1): the procedural humanoid and a clothes donor
// with the same skeleton (a red jacket). Original procedural content only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { writePmx } from '@/lib/convert/pmx/writer';
import { makeEditFixture, type FixtureFiles } from './fixture';

const OUT = join(__dirname, '../../../e2e/fixtures');

function write(dir: string, file: string, f: FixtureFiles): void {
  mkdirSync(join(OUT, dir, 'tex'), { recursive: true });
  writeFileSync(join(OUT, dir, file), new Uint8Array(writePmx(f.pmx)));
  for (const [p, data] of Object.entries(f.textures)) writeFileSync(join(OUT, dir, p), data);
}

it.skipIf(!process.env.GEN_FIXTURES)('generate the model editor fixtures', () => {
  write('EditTest', 'edittest.pmx', makeEditFixture());
  write(
    'EditDonor',
    'donor.pmx',
    makeEditFixture({
      name: 'ジャケットドナー',
      nameEn: 'Donor',
      materials: ['ジャケット'],
      topName: 'ジャケット',
      topColor: [0.8, 0.15, 0.15],
    }),
  );
});
