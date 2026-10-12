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
  getNprAmbient(): { sky: number[]; ground: number[] };
}
type W = Window & { __studio?: Studio };

test('toon ambient follows the HDR environment when the background is HDR', async ({ page }) => {
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles(MODEL);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);

  const manual = await page.evaluate(() => (window as W).__studio!.getNprAmbient());

  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add model or files' }).click();
  await (await chooser).setFiles([join(fixtures, 'sky.hdr')]);
  await page.getByRole('tab', { name: 'Scene' }).click();
  await page.getByTestId('right').getByLabel('Mode', { exact: true }).selectOption('hdr');

  await expect
    .poll(async () => {
      const a = await page.evaluate(() => (window as W).__studio!.getNprAmbient());
      return Math.abs(a.sky[0] - manual.sky[0]) + Math.abs(a.sky[2] - manual.sky[2]);
    })
    .toBeGreaterThan(0.01);

  // Back to a plain background: the manual ambient returns.
  await page.getByTestId('right').getByLabel('Mode', { exact: true }).selectOption('gradient');
  await expect
    .poll(async () => (await page.evaluate(() => (window as W).__studio!.getNprAmbient())).sky[0])
    .toBeCloseTo(manual.sky[0], 3);
});
