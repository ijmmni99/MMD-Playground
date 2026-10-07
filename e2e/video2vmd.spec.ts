import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';

// Video → VMD with the synthetic pose estimator (?pose=synthetic): the fixture video is the procedural
// stick figure and the estimator returns the same figure's landmarks, so no ML model is downloaded.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const VIDEO = join(fixtures, 'stick-dance.webm');
const MANNEQUIN = join(fixtures, 'Mannequin/mannequin.pmx');

interface Studio {
  listModels(): string[];
  getPlayback(): { frame: number; playing: boolean; duration: number };
  getBoneWorldPositions(id: string): Record<string, [number, number, number]>;
  seek(f: number): void;
  pause(): void;
}
type W = Window & { __studio?: Studio };

async function boot(page: Page): Promise<void> {
  await page.goto('/?engine=1&pose=synthetic');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
}

async function chooseVideo(page: Page): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('v2v-choose-video').click();
  await (await chooser).setFiles(VIDEO);
  await expect(page.getByTestId('v2v-info')).toContainText('480×270');
}

test('video → VMD: detect, retarget onto a PMX, apply, export, reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page);
  await page.getByLabel('Render quality').selectOption('low');

  // A model with the standard MMD bones and leg IK.
  const modelChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await modelChooser).setFiles(MANNEQUIN);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);

  // Import.
  await page.getByRole('tab', { name: /Video/ }).click();
  await chooseVideo(page);
  await expect(page.getByTestId('v2v-info')).toContainText('30.00 fps');
  await expect(page.getByTestId('v2v-info')).toContainText('4.00 s');

  // Detect: cancel part-way, then resume.
  await page.getByTestId('v2v-detect').click();
  await expect(page.getByTestId('v2v-cancel')).toBeVisible();
  await page.getByTestId('v2v-cancel').click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Presets' })).toBeVisible({ timeout: 120_000 });

  // Retarget + quality report.
  await page.getByRole('button', { name: 'Continue' }).click();
  const report = page.getByTestId('v2v-report');
  await expect(report).toContainText('マネキン');
  await expect(report).toContainText('100%');

  // Preview: apply to the model and play.
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('v2v-apply').click();
  await expect(page.getByTestId('v2v-applied')).toContainText('マネキン');
  await expect
    .poll(() => page.evaluate(() => (window as W).__studio!.getPlayback().frame), { timeout: 30_000 })
    .toBeGreaterThan(10);

  // Feet stay on (not under) the floor while the motion plays.
  await page.evaluate(() => (window as W).__studio!.pause());
  const id = await page.evaluate(() => (window as W).__studio!.listModels()[0]);
  for (const f of [10, 45, 80]) {
    await page.evaluate((frame) => (window as W).__studio!.seek(frame), f);
    await page.waitForTimeout(250);
    const bones = await page.evaluate((m) => (window as W).__studio!.getBoneWorldPositions(m), id);
    expect(Math.min(bones['左足首'][1], bones['右足首'][1])).toBeGreaterThan(1.2);
  }

  // Audio passthrough.
  await page.getByTestId('v2v-audio').click();
  await expect(page.getByText('stick-dance-audio.wav').first()).toBeVisible({ timeout: 30_000 });

  // Export: the downloaded VMD is valid and loads as a motion.
  await page.getByRole('button', { name: 'Continue to export' }).click();
  await expect(page.getByTestId('v2v-keys')).toContainText('after reduction');
  const download = page.waitForEvent('download');
  await page.getByTestId('v2v-download').click();
  const file = await (await download).path();
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 25).toString('ascii')).toBe('Vocaloid Motion Data 0002');
  const boneKeys = bytes.readUInt32LE(50);
  expect(boneKeys).toBeGreaterThan(50);
  expect(bytes.length).toBeGreaterThanOrEqual(54 + boneKeys * 111 + 20);

  await page.getByRole('tab', { name: 'studio' }).click();
  const motion = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add model or files' }).click();
  await (
    await motion
  ).setFiles({ name: 'downloaded.vmd', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.getByTestId('model-list')).toContainText('downloaded.vmd', { timeout: 30_000 });

  // Reload: the session (pose data, settings) and the applied motion are restored.
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 30_000 });
  await page.reload();
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  await page.getByRole('tab', { name: /Video/ }).click();
  await expect(page.getByTestId('v2v-panel')).toBeVisible();
  await expect(page.getByTestId('v2v-stepper').getByRole('button', { name: /Export/ })).toBeEnabled();
  await page
    .getByTestId('v2v-stepper')
    .getByRole('button', { name: /Retarget/ })
    .click();
  await expect(page.getByTestId('v2v-report')).toContainText('100%', { timeout: 30_000 });

  expect(errors).toEqual([]);
});

test.describe('phone', () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['Pixel 7'];
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

  test('video → VMD is usable in the bottom sheet', async ({ page }) => {
    await boot(page);
    await page.getByTestId('tab-bar').locator('[data-tab="more"]').click();
    await page.getByRole('button', { name: /Video to VMD/ }).click();
    const sheet = page.getByTestId('bottom-sheet');
    await expect(sheet).toHaveAttribute('data-snap', 'full');
    await expect(page.getByTestId('v2v-panel')).toBeVisible();
    await chooseVideo(page);
    await page.getByTestId('v2v-detect').click();
    await expect(page.getByRole('radiogroup', { name: 'Presets' })).toBeVisible({ timeout: 120_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('v2v-report')).toContainText('MMD Studio');
  });
});
