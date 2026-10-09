import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Real MediaPipe (not the synthetic estimators): the self-hosted WASM runtime plus Google's pose model, on
// both detection paths. The main-thread path is what iOS Safari uses when the WebCodecs worker can't run.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

for (const path of ['worker', 'main thread'] as const) {
  test(`real MediaPipe pose detection runs (${path})`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => /ModuleFactory/.test(m.text()) && errors.push(m.text()));
    await page.goto(`/?engine=1${path === 'main thread' ? '&poseWorker=off' : ''}`);
    await page.waitForFunction(() => '__studio' in window, null, { timeout: 90_000 });
    await page.getByRole('tab', { name: /Video/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('v2v-choose-video').click();
    await (await chooser).setFiles(join(fixtures, 'stick-dance.webm'));
    await expect(page.getByTestId('v2v-info')).toBeVisible();
    await page.getByTestId('v2v-detect').click();
    // A few frames processed means the runtime and the model both loaded.
    await expect(page.getByTestId('v2v-panel').first()).toContainText(/(^|\D)([3-9]|\d{2,}) \/ 120 frames/, {
      timeout: 180_000,
    });
    await expect(page.getByTestId('v2v-panel').first()).not.toContainText('ModuleFactory');
    expect(errors).toEqual([]);
  });
}
