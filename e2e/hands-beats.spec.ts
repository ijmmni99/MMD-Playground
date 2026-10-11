import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PMX = [join(fixtures, 'FaceHands/facehands.pmx'), join(fixtures, 'FaceHands/tex')];
const BEAT = join(fixtures, 'beat.wav');

interface Studio {
  listModels(): string[];
}
interface MotionEditorProbe {
  state(): {
    modelId: string | null;
    clips: Record<string, { bones: { name: string; keys: { f: number }[] }[] }>;
    grid: { bpm: number; offset: number };
  };
}
type W = Window & { __studio?: Studio; __motionEditor?: MotionEditorProbe };

async function boot(page: Page, files: string[]): Promise<void> {
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  await page.getByLabel('Render quality').selectOption('low');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles(files);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
}

test('hand presets key the finger bones at the playhead', async ({ page }) => {
  await boot(page, [
    ...PMX.slice(0, 1),
    ...(await import('node:fs')).readdirSync(PMX[1]).map((f) => join(PMX[1], f)),
  ]);
  await page.getByTestId('open-editor').click();
  await expect(page.getByTestId('dope-sheet')).toBeVisible();
  await page.getByTestId('me-tools').click();
  await page.getByTestId('me-tools-panel').getByText('Hands', { exact: true }).click();
  await page.getByTestId('hand-fist').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as W).__motionEditor!.state();
        return s.clips[s.modelId!].bones.filter((t) => /指/.test(t.name)).length;
      }),
    )
    .toBeGreaterThan(10);
});

test('Detect from music sets the tempo from a 120 BPM beat', async ({ page }) => {
  await boot(page, [
    ...PMX.slice(0, 1),
    ...(await import('node:fs')).readdirSync(PMX[1]).map((f) => join(PMX[1], f)),
    BEAT,
  ]);
  await page.getByTestId('open-editor').click();
  await page.getByTestId('me-markers').click();
  await page.getByTestId('bpm-detect').click();
  await expect
    .poll(() => page.evaluate(() => (window as W).__motionEditor!.state().grid.bpm))
    .toBeGreaterThan(117);
  const bpm = await page.evaluate(() => (window as W).__motionEditor!.state().grid.bpm);
  expect(bpm).toBeLessThan(123);
});
