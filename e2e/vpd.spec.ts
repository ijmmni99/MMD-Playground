import { readFileSync } from 'node:fs';
import Encoding from 'encoding-japanese';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MODEL = [
  join(fixtures, 'LookTest/looktest.pmx'),
  join(fixtures, 'LookTest/tex/face.png'),
  join(fixtures, 'LookTest/tex/top.png'),
];

interface Studio {
  listModels(): string[];
  getMorphWeights(id: string): Record<string, number>;
}
type W = Window & { __studio?: Studio };

test('a dropped VPD sets morphs, and Save VPD writes a valid file', async ({ page }) => {
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles(MODEL);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  const id = await page.evaluate(() => (window as W).__studio!.listModels()[0]);
  const morph = await page.evaluate((i) => Object.keys((window as W).__studio!.getMorphWeights(i))[0], id);
  expect(morph).toBeTruthy();

  const vpd = [
    'Vocaloid Pose Data file',
    '',
    'looktest.osm;\t\t// parent',
    '1;',
    '',
    `Morph0{${morph}`,
    '  1.000000;',
    '}',
    '',
  ].join('\r\n');
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add model or files' }).click();
  await (
    await chooser
  ).setFiles([
    {
      name: 'pose.vpd',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(Encoding.convert(Encoding.stringToCode(vpd), { to: 'SJIS', from: 'UNICODE' })),
    },
  ]);
  await expect
    .poll(() => page.evaluate((i) => (window as W).__studio!.getMorphWeights(i), id).then((w) => w[morph]))
    .toBeCloseTo(1, 3);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save VPD' }).click();
  const path = await (await download).path();
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 23).toString('ascii')).toBe('Vocaloid Pose Data file');
});
