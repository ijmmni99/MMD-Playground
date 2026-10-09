import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';

// NPR looks on a procedural humanoid with skin, face, hair, cloth, stockings, metal and eye materials
// (src/lib/model-edit/fixture.ts with npr: true; regenerate with GEN_FIXTURES=1). No third-party assets.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MODEL = [
  join(fixtures, 'LookTest/looktest.pmx'),
  join(fixtures, 'LookTest/tex/face.png'),
  join(fixtures, 'LookTest/tex/top.png'),
];
const MATERIALS = [
  '髪',
  '顔',
  '体',
  'トップス',
  'スカート',
  '靴',
  '手袋',
  'リボン',
  '目',
  'ニーソ',
  'ベルト金具',
];
const LOOKS = [
  'animeSkin',
  'animeFace',
  'animeHair',
  'clothSmooth',
  'clothRough',
  'stockings',
  'metal',
  'eye',
  'flatUnlit',
];

interface Stats {
  materials: number;
  heavy: number;
  failed: string[];
  supported: boolean;
  tier: string;
}
interface Studio {
  listModels(): string[];
  setModelLooks(id: string, l: unknown): void;
  setNprSettings(s: unknown): void;
  getNprStats(): Stats;
  setModelPhysics(id: string, on: boolean): void;
  setCameraState(s: unknown): void;
  getCameraState(): Record<string, unknown>;
  screenshot(o: { width: number; height: number; transparent: boolean }): Promise<Blob>;
  getBoneWorldPositions(id: string): Record<string, [number, number, number]>;
  getMorphWeights(id: string): Record<string, number>;
  setMorph(id: string, name: string, w: number): void;
  seek(f: number): void;
  pause(): void;
}
type W = Window & { __studio?: Studio };

async function boot(page: Page, query = ''): Promise<string> {
  await page.goto(`/?engine=1${query}`);
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  const q = page.getByLabel('Render quality');
  if (await q.isVisible().catch(() => false)) await q.selectOption('high');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles(MODEL);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  const id = await page.evaluate(() => (window as W).__studio!.listModels()[0]);
  // Still model, fixed camera: renders are comparable.
  await page.evaluate((m) => {
    const s = (window as W).__studio!;
    s.setModelPhysics(m, false);
    s.setCameraState({
      ...s.getCameraState(),
      mode: 'orbit',
      target: [0, 11, 0],
      alpha: -Math.PI / 2.6,
      beta: Math.PI / 2.3,
      radius: 26,
      fov: 40,
    });
  }, id);
  return id;
}

/** Downsampled RGB of an engine screenshot (in-page decode). */
async function grab(page: Page): Promise<number[]> {
  await page.waitForTimeout(700);
  return page.evaluate(async () => {
    const blob = await (window as W).__studio!.screenshot({ width: 320, height: 240, transparent: false });
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(160, 120);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, 160, 120);
    const d = ctx.getImageData(0, 0, 160, 120).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4) out.push(d[i], d[i + 1], d[i + 2]);
    return out;
  });
}

/** Mean absolute channel difference (0–255). */
const diff = (a: number[], b: number[]): number =>
  a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

const allLook = (look: string, extra: Record<string, unknown> = {}) => ({
  seeThroughEyes: true,
  materials: Object.fromEntries(MATERIALS.map((n) => [n, { look, ...extra }])),
});

test('looks: Default matches the renderer without NPR; every preset compiles, changes the image, per tier', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // Baseline: NPR system off entirely.
  await boot(page, '&npr=off');
  const baseline = await grab(page);

  const id = await boot(page);
  const plain = await grab(page);
  expect(diff(plain, baseline)).toBeLessThan(0.5); // Default (system on, no looks) = previous rendering
  await page.evaluate(
    (m) => (window as W).__studio!.setModelLooks(m, { seeThroughEyes: true, materials: {} }),
    id,
  );
  expect(diff(await grab(page), baseline)).toBeLessThan(0.5);

  const results: Record<string, number> = {};
  for (const tier of ['high', 'medium', 'low']) {
    await page.evaluate(
      (t) =>
        (window as W).__studio!.setNprSettings({
          tier: t,
          showOriginal: false,
          toonStrength: 1,
          rimStrength: 1,
          shadowWarmth: 0,
          outlineMode: 'hull',
          outlineFalloff: true,
        }),
      tier,
    );
    const seen: number[][] = [];
    for (const look of LOOKS) {
      await page.evaluate(([m, l]) => (window as W).__studio!.setModelLooks(m, l), [
        id,
        allLook(look),
      ] as const);
      const img = await grab(page);
      const d = diff(img, baseline);
      results[`${tier}/${look}`] = Number(d.toFixed(2));
      expect(d, `${tier}/${look} should change the image`).toBeGreaterThan(0.4);
      // Different presets give different images.
      for (const other of seen) expect(diff(img, other), `${tier}/${look} distinct`).toBeGreaterThan(0.05);
      seen.push(img);
      const stats = await page.evaluate(() => (window as W).__studio!.getNprStats());
      expect(stats.failed, `${tier}/${look} compiled`).toEqual([]);
      expect(stats.materials).toBe(MATERIALS.length);
      if (tier === 'high')
        await page
          .locator('canvas')
          .first()
          .screenshot({ path: `e2e/__shots/npr-${look}.png` });
    }
  }
  writeFileSync('e2e/__shots/npr-diffs.json', JSON.stringify(results, null, 2));
  expect(errors).toEqual([]);
});

test('looks: a failing variant falls back to the PMX original with a message', async ({ page }) => {
  test.setTimeout(180_000);
  const id = await boot(page, '&nprBreak=animeSkin');
  const original = await grab(page);
  await page.evaluate(([m, l]) => (window as W).__studio!.setModelLooks(m, l), [
    id,
    allLook('animeSkin'),
  ] as const);
  await expect(page.getByText(/couldn't be compiled/).first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => (window as W).__studio!.getNprStats().failed))
    .toContain('animeSkin');
  await expect
    .poll(() => page.evaluate(() => (window as W).__studio!.getNprStats().materials), { timeout: 30_000 })
    .toBe(0);
  await expect.poll(async () => diff(await grab(page), original), { timeout: 30_000 }).toBeLessThan(1);
});

test('looks: skinning and morphs still play with looks applied', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = await boot(page);
  await page.evaluate(([m, l]) => (window as W).__studio!.setModelLooks(m, l), [
    id,
    allLook('animeSkin'),
  ] as const);
  const before = await grab(page);
  await page.evaluate((m) => (window as W).__studio!.setMorph(m, 'まばたき', 1), id);
  expect(await page.evaluate((m) => (window as W).__studio!.getMorphWeights(m)['まばたき'], id)).toBe(1);
  await page.evaluate((m) => {
    const s = (window as W).__studio! as unknown as {
      setBoneTransform(id: string, b: number, t: unknown): void;
      getSkeleton(id: string): { bones: { name: string }[] };
    };
    const b = s.getSkeleton(m).bones.findIndex((x) => x.name === '左腕');
    s.setBoneTransform(m, b, { position: [0, 0, 0], rotation: [0, 0, 0.5, 0.866] });
  }, id);
  expect(diff(await grab(page), before)).toBeGreaterThan(0.3);
  expect(errors).toEqual([]);
});

test('looks UI: auto-assign, tweak live, before / after, save, reload', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const id = await boot(page);
  const plain = await grab(page);
  await page.getByRole('button', { name: /Looks \(anime/ }).click();
  await page.getByTestId('look-auto').click();
  await expect(page.getByTestId('look-select-髪')).toHaveValue('animeHair');
  await expect(page.getByTestId('look-select-顔')).toHaveValue('animeFace');
  await expect(page.getByTestId('look-select-体')).toHaveValue('animeSkin');
  await expect(page.getByTestId('look-select-トップス')).toHaveValue('clothSmooth');
  await expect(page.getByTestId('look-select-ニーソ')).toHaveValue('stockings');
  await expect(page.getByTestId('look-select-ベルト金具')).toHaveValue('metal');
  await expect(page.getByTestId('look-select-目')).toHaveValue('eye');
  const after = await grab(page);
  expect(diff(after, plain)).toBeGreaterThan(0.8);
  await page.locator('canvas').first().screenshot({ path: 'e2e/__shots/npr-auto.png' });

  // Tweak the top's rim live.
  await page.getByRole('button', { name: /Edit look of .*トップス/ }).click();
  const rim = page.getByTestId('look-param-rimStrength').getByRole('textbox');
  await rim.fill('2');
  await rim.press('Enter');
  const tweaked = await grab(page);
  expect(diff(tweaked, after)).toBeGreaterThan(0.05);

  // Before / after.
  await page.getByRole('switch', { name: 'Before / after' }).click();
  expect(diff(await grab(page), plain)).toBeLessThan(0.5);
  await page.getByRole('switch', { name: 'Before / after' }).click();
  expect(diff(await grab(page), tweaked)).toBeLessThan(0.5);

  // Undo the tweak, redo it.
  await page.keyboard.press('Control+z');
  expect(diff(await grab(page), after)).toBeLessThan(0.5);
  await page.keyboard.press('Control+Shift+z');

  // Save and reload: looks come back.
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 30_000 });
  await page.reload();
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, { timeout: 90_000 });
  await expect
    .poll(() => page.evaluate(() => (window as W).__studio!.listModels().length), { timeout: 60_000 })
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as W).__studio!.getNprStats().materials), { timeout: 60_000 })
    .toBe(MATERIALS.length);
  await page.evaluate((m) => {
    const s = (window as W).__studio!;
    s.setModelPhysics(m, false);
    s.setCameraState({
      ...s.getCameraState(),
      mode: 'orbit',
      target: [0, 11, 0],
      alpha: -Math.PI / 2.6,
      beta: Math.PI / 2.3,
      radius: 26,
      fov: 40,
    });
  }, id);
  expect(diff(await grab(page), tweaked)).toBeLessThan(1.5);
  await page.getByRole('button', { name: /Looks \(anime/ }).click();
  await expect(page.getByTestId('look-select-髪')).toHaveValue('animeHair');
  expect(errors).toEqual([]);
});

test.describe('phone', () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['Pixel 7'];
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });
  test('phones use the Low tier and the look list has 44 px targets', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?engine=1');
    await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
      timeout: 90_000,
      polling: 500,
    });
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('tab-bar').locator('[data-tab="models"]').click();
    await page
      .getByRole('button', { name: /Add model/ })
      .first()
      .click();
    await (await chooser).setFiles(MODEL);
    await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
    await page.getByTestId('tab-bar').locator('[data-tab="inspector"]').click();
    await page.getByRole('button', { name: /Looks \(anime/ }).click();
    await page.getByTestId('look-auto').click();
    await expect
      .poll(() => page.evaluate(() => (window as W).__studio!.getNprStats().materials))
      .toBe(MATERIALS.length);
    expect(await page.evaluate(() => (window as W).__studio!.getNprStats().tier)).toBe('low');
    const sel = await page.getByTestId('look-select-髪').boundingBox();
    expect(sel!.height).toBeGreaterThanOrEqual(43);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: 'e2e/__shots/npr-phone.png' });
    expect(errors).toEqual([]);
  });
});
