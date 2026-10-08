import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { devices, expect, test, type Page } from '@playwright/test';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const VRM = join(fixtures, 'converter/humanoid-vrm1.vrm');
const FBX_ZIP = join(fixtures, 'converter/mixamo-fbx.zip');
const GLTF_ZIP = join(fixtures, 'converter/gltf-avatar.zip');
const SCRAMBLED = join(fixtures, 'converter/scrambled.glb');
const DANCE = join(fixtures, 'Mannequin/mannequin-dance.vmd');

interface Studio {
  listModels(): string[];
  getPlayback(): { frame: number; playing: boolean; duration: number };
  getBoneWorldPositions(id: string): Record<string, [number, number, number]>;
  seek(f: number): void;
}
type W = Window & { __studio?: Studio };

async function boot(page: Page): Promise<void> {
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, { timeout: 90_000, polling: 500 });
  const q = page.getByLabel('Render quality');
  if (await q.isVisible().catch(() => false)) await q.selectOption('low');
}

async function pick(page: Page, testid: string, files: string[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(testid).click();
  await (await chooser).setFiles(files);
}

const models = (page: Page): Promise<number> => page.evaluate(() => (window as W).__studio!.listModels().length);

/** All bone positions finite and within a sane box (no physics explosion). */
async function bounded(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const s = (window as W).__studio!;
    return s.listModels().every((id) =>
      Object.values(s.getBoneWorldPositions(id)).every((p) => p.every((v) => Number.isFinite(v) && Math.abs(v) < 200)),
    );
  });
}

test('model converter: VRM → PMX with mapping, face, physics, preview, license, load, export, reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await boot(page);
  await page.getByTestId('mode-converter').click();
  await expect(page.getByTestId('cv-panel')).toBeVisible();

  await pick(page, 'cv-pick', [VRM]);
  await expect(page.getByTestId('cv-mapping-summary')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('cv-mapping-summary')).not.toContainText('missing');
  await expect(page.getByText('every body bone is mapped')).toBeVisible();
  // The live preview model appears in the scene.
  await expect.poll(() => models(page), { timeout: 60_000 }).toBe(1);

  await page.getByTestId('cv-next-check').click();
  await expect(page.getByText(/Rest pose: T-pose/)).toBeVisible();
  await page.getByTestId('cv-next-pose').click();
  await expect(page.getByTestId('cv-morphs')).toContainText('Fcl_EYE_Close');
  await page.getByTestId('cv-next-face').click();
  await expect(page.getByTestId('cv-chains')).toContainText('VRM spring');
  await page.getByTestId('cv-next-physics').click();

  // Preview: the test dance plays; physics stays bounded.
  await page.getByTestId('cv-test-dance').click();
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.getPlayback().playing)).toBe(true);
  await page.waitForTimeout(2500);
  expect(await bounded(page)).toBe(true);
  await page.getByText('Show the original next to it').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/__shots/converter-preview.png' });
  await page.getByTestId('cv-next-preview').click();

  // Export: license shown, acknowledgement required.
  await expect(page.getByTestId('cv-license')).toContainText('MMD Studio');
  await expect(page.getByTestId('cv-load')).toBeDisabled();
  await page.getByTestId('cv-license-ack').check();
  const download = page.waitForEvent('download');
  await page.getByTestId('cv-download').click();
  const zip = await JSZip.loadAsync(readFileSync(await (await download).path()));
  const names = Object.keys(zip.files);
  expect(names).toEqual(expect.arrayContaining(['model.pmx', 'README.txt', 'conversion-report.json', 'tex/face_skin.png']));
  const pmx = await zip.file('model.pmx')!.async('uint8array');
  expect(new TextDecoder().decode(pmx.subarray(0, 4))).toBe('PMX ');
  expect(await zip.file('README.txt')!.async('string')).toContain('personalNonProfit');

  // Load into the studio: it stays as a normal model, with English bone labels.
  await page.getByTestId('cv-load').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-testid="cv-panel"]') === null)).toBe(true);
  await expect.poll(() => models(page)).toBe(1);
  await expect(page.getByTestId('model-list')).toContainText('Test VRM');

  // A regular VMD drives it (foot IK); physics stays bounded.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open files \/ ZIP…|Upload ZIP or files…|^Add model/ }).first().click();
  await (await chooser).setFiles([DANCE]);
  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(2500);
  expect(await bounded(page)).toBe(true);
  const feet = await page.evaluate(() => {
    const s = (window as W).__studio!;
    const p = s.getBoneWorldPositions(s.listModels()[0]);
    return [p['左足首'][1], p['右足首'][1]];
  });
  expect(Math.min(...feet)).toBeGreaterThan(-0.5);

  // Reload: the converted model is part of the project.
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 30_000 });
  await page.reload();
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, { timeout: 90_000 });
  await expect.poll(() => models(page), { timeout: 60_000 }).toBe(1);
  await expect(page.getByTestId('model-list')).toContainText('Test VRM');
  expect(errors).toEqual([]);
});

test('model converter: FBX and glTF ZIPs convert with defaults; a mis-named rig is fixed by hand', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await boot(page);
  await page.getByTestId('mode-converter').click();

  for (const [file, name] of [
    [FBX_ZIP, 'character.fbx'],
    [GLTF_ZIP, 'humanoid.gltf'],
  ]) {
    await page.getByTestId('cv-step-import').click();
    await pick(page, 'cv-pick', [file]);
    await expect(page.getByTestId('cv-mapping-summary')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('every body bone is mapped')).toBeVisible();
    await page.getByTestId('cv-step-import').click();
    await expect(page.getByTestId('cv-summary')).toContainText(name);
    await page.getByTestId('cv-step-face').click();
    await expect(page.getByTestId('cv-morphs')).toBeVisible();
    await page.getByTestId('cv-step-preview').click();
    await expect(page.getByTestId('cv-stats')).toContainText('Rigid bodies');
    await expect.poll(() => models(page), { timeout: 60_000 }).toBe(1);
  }

  // Scrambled names: structural guesses need a review.
  await page.getByTestId('cv-step-import').click();
  await pick(page, 'cv-pick', [SCRAMBLED]);
  await expect(page.getByText(/were guessed/)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('cv-open-mapping').click();
  await expect(page.getByTestId('mapping-dialog')).toBeVisible();
  // Re-assign the head by hand, then accept the remaining suggestions.
  await page.getByTestId('map-slot-head').click();
  const headBone = await page.getByTestId('map-slot-head').locator('span').nth(1).textContent();
  await page.getByTestId('mapping-bones').locator(`[data-bone="${headBone}"]`).click();
  await page.getByTestId('mapping-accept').click();
  await page.screenshot({ path: 'e2e/__shots/converter-mapping.png' });
  await page.getByTestId('mapping-done').click();
  await expect(page.getByText('every body bone is mapped')).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

for (const [name, device] of [
  ['phone', devices['Pixel 7']],
  ['tablet', devices['iPad (gen 7)']],
] as const) {
  test.describe(name, () => {
    const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = device;
    test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });
    test(`model converter is usable on ${name}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await boot(page);
      if (name === 'phone') {
        await page.getByTestId('tab-bar').locator('[data-tab="more"]').click();
        await page.getByTestId('more-converter').click();
      } else await page.getByTestId('mode-converter').click();
      await expect(page.getByTestId('cv-panel').first()).toBeVisible();
      await page.getByTestId('cv-sample').click();
      await expect(page.getByTestId('cv-mapping-summary')).toBeVisible({ timeout: 60_000 });
      expect((await page.getByTestId('cv-open-mapping').boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.getByTestId('cv-open-mapping').click();
      await expect(page.getByTestId('mapping-dialog')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `e2e/__shots/converter-${name}-mapping.png` });
      await page.getByTestId('mapping-done').click();
      await page.getByTestId('cv-step-export').click();
      await page.getByTestId('cv-license-ack').check();
      await page.screenshot({ path: `e2e/__shots/converter-${name}.png` });
      await expect.poll(() => models(page), { timeout: 60_000 }).toBe(1);
      expect(errors).toEqual([]);
    });
  });
}
