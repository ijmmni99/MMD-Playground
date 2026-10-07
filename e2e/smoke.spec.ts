import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const files = [
  'Blocky/blocky.pmx',
  'Blocky/tex/skin.png',
  'Blocky/tex/hair.png',
  'dance.vmd',
  'camera.vmd',
  'beat.wav',
].map((f) => join(fixtures, f));

async function waitForEngine(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __studio?: unknown }).__studio !== undefined,
    null,
    { timeout: 90_000, polling: 500 },
  );
}

const frame = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (window as unknown as { __studio: { getPlayback(): { frame: number } } }).__studio.getPlayback().frame,
  );

test('load model + motion + audio, play, screenshot, restore after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?engine=1');
  await waitForEngine(page);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await page.getByLabel('Render quality').selectOption('low');

  // Upload through the real file chooser. Files arrive without folders, so texture
  // references resolve through the basename fallback.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles(files);

  const models = page.getByTestId('model-list').getByRole('option');
  await expect(models).toHaveCount(1);
  await expect(models.first()).toContainText('ブロッキー');
  await expect(models.first()).toContainText('dance.vmd');
  await expect(page.getByText('camera.vmd ·')).toBeVisible();
  await expect(page.getByText('beat.wav ·')).toBeVisible();
  await expect(page.getByTestId('timecode')).toContainText('/ 00:08.00');

  // Inspector shows morph groups and the physics toggle.
  await expect(page.getByTestId('model-inspector')).toContainText('Morphs (4)');
  await expect(page.getByRole('switch', { name: 'Simulate hair / skirt' })).toBeChecked();

  // Play / pause
  await page.getByTestId('play-toggle').click();
  await expect.poll(() => frame(page), { timeout: 60_000 }).toBeGreaterThan(15);
  await page.getByTestId('play-toggle').click();
  const paused = await frame(page);
  await page.waitForTimeout(1000);
  expect(Math.abs((await frame(page)) - paused)).toBeLessThan(1);

  // Keyboard frame stepping
  await page.getByTestId('viewport-canvas').focus();
  await page.keyboard.press('Home');
  await expect.poll(() => frame(page)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => frame(page)).toBe(1);

  // Screenshot export
  await page.getByRole('tab', { name: 'Export' }).click();
  await page.getByLabel('Resolution').first().selectOption('720p');
  const download = page.waitForEvent('download');
  await page.getByTestId('screenshot-button').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  await page.screenshot({ path: test.info().outputPath('viewport.png') });

  // Autosave, then reload and expect the project to be restored from IndexedDB.
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 30_000 });
  await page.reload();
  await waitForEngine(page);
  await expect(page.getByTestId('model-list').getByRole('option')).toHaveCount(1);
  await expect(page.getByTestId('model-list')).toContainText('dance.vmd');
  await expect(page.getByTestId('timecode')).toContainText('/ 00:08.00');

  expect(errors).toEqual([]);
});

test('built-in sample and playground script', async ({ page }) => {
  // Surface page diagnostics in CI logs.
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      console.log(`[page ${m.type()}] ${m.text().slice(0, 300)}`);
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?engine=1');
  await waitForEngine(page);
  await page.getByLabel('Render quality').selectOption('low');
  await page.getByTestId('load-sample').click();
  await expect(page.getByTestId('model-list').getByRole('option')).toHaveCount(1);

  await page.getByRole('tab', { name: 'playground' }).click();
  await expect(page.getByTestId('playground').locator('.monaco-editor')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Load example').selectOption('blink');
  await page.getByTestId('run-script').click();
  await expect(page.getByTestId('console')).toContainText('Blinking with morph: まばたき');
  expect(errors).toEqual([]);
});

test('first visit defers the 3D engine until it is needed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => '__studio' in window)).toBe(false);
  await page.getByTestId('load-sample').first().click();
  await waitForEngine(page);
});

test('stage: loads as scenery, keeps the dancer selected, motions go to the dancer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?engine=1');
  await waitForEngine(page);
  await page.getByLabel('Render quality').selectOption('low');
  const model = ['Blocky/blocky.pmx', 'Blocky/tex/skin.png', 'Blocky/tex/hair.png'].map((f) =>
    join(fixtures, f),
  );
  const rows = page.getByTestId('model-list').getByRole('option');

  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles(model);
  await expect(rows).toHaveCount(1);

  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add stage (scenery model)' }).click();
  await (await chooser).setFiles(model);
  await expect(rows).toHaveCount(2);
  // The dancer stays selected; the stage row carries the stage icon.
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false');
  await expect(rows.nth(1).getByLabel('Stage')).toBeVisible();

  // Even with the stage selected, a new motion goes to the dancer.
  await rows.nth(1).click();
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add model or files' }).click();
  await (await chooser).setFiles([join(fixtures, 'dance.vmd')]);
  await expect(rows.nth(0)).toContainText('dance.vmd');
  await expect(rows.nth(1)).not.toContainText('dance.vmd');

  // The stage flag survives a reload.
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 30_000 });
  await page.reload();
  await waitForEngine(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).getByLabel('Stage')).toBeVisible();
  expect(errors).toEqual([]);
});
