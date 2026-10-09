import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Real MediaPipe (not the synthetic estimators): the self-hosted WASM runtime plus Google's pose model, on
// both detection paths. The main-thread path is what iOS Safari uses when the WebCodecs worker can't run.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// "Body + face + fingers" creates several landmarkers from one runtime (MediaPipe clears its factory after each).
const cases = [
  { path: 'worker', extras: false },
  { path: 'main thread', extras: false },
  { path: 'worker', extras: true },
  { path: 'main thread', extras: true },
] as const;

for (const { path, extras } of cases) {
  test(`real MediaPipe detection runs (${path}${extras ? ', body + face + fingers' : ''})`, async ({ page }) => {
    test.setTimeout(300_000);
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
    if (extras) {
      await page.getByTestId('v2v-capture-balanced').click();
      await page.getByTestId('v2v-feature-fingers').check();
    }
    await page.getByTestId('v2v-detect').click();
    // A few frames processed means the runtime and the model both loaded.
    await expect(page.getByTestId('v2v-panel').first()).toContainText(/(^|\D)([3-9]|\d{2,}) \/ 120 frames/, {
      timeout: 240_000,
    });
    await expect(page.getByTestId('v2v-panel').first()).not.toContainText('ModuleFactory');
    expect(errors).toEqual([]);
  });
}
