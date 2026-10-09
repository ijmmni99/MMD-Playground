import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';

// Video → VMD v2 (two-view + face + fingers) with the synthetic two-camera estimators (?pose=synthetic2):
// the fixture videos are renders of the same synthetic dancer from cameras 90° apart, the side one offset by
// 0.4 s (scripts/make-twoview-fixture.ts), and the estimators return those cameras' observations.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FRONT = join(fixtures, 'twoview-front.webm');
const SIDE = join(fixtures, 'twoview-side.webm');
const MODEL = [join(fixtures, 'FaceHands/facehands.pmx'), join(fixtures, 'FaceHands/tex/face_skin.png')];

interface Studio {
  listModels(): string[];
  getPlayback(): { frame: number; playing: boolean; duration: number };
  getBoneWorldPositions(id: string): Record<string, [number, number, number]>;
  getMorphWeights(id: string): Record<string, number>;
  seek(f: number): void;
  pause(): void;
}
type W = Window & {
  __studio?: Studio;
  __clipTimeline?: { get(): { doc: { tracks: { kind: string }[]; clips: { trackId: string }[] } } };
};

async function boot(page: Page): Promise<void> {
  await page.goto('/?engine=1&pose=synthetic2&sideOffset=0.4&sideYaw=90');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  const q = page.getByLabel('Render quality');
  if (await q.isVisible().catch(() => false)) await q.selectOption('low');
}

async function choose(page: Page, testid: string, file: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(testid).click();
  await (await chooser).setFiles(file);
}

/** Minimal VMD reader: bone names and morph names with their key counts. */
function readVmd(bytes: Buffer): { bones: Map<string, number>; morphs: Map<string, number> } {
  const dec = new TextDecoder('shift_jis');
  const name = (o: number, n: number): string => {
    const b = bytes.subarray(o, o + n);
    const z = b.indexOf(0);
    return dec.decode(z >= 0 ? b.subarray(0, z) : b);
  };
  let o = 50;
  const boneCount = bytes.readUInt32LE(o);
  o += 4;
  const bones = new Map<string, number>();
  for (let i = 0; i < boneCount; i++, o += 111) bones.set(name(o, 15), (bones.get(name(o, 15)) ?? 0) + 1);
  const morphCount = bytes.readUInt32LE(o);
  o += 4;
  const morphs = new Map<string, number>();
  for (let i = 0; i < morphCount; i++, o += 23) morphs.set(name(o, 15), (morphs.get(name(o, 15)) ?? 0) + 1);
  return { bones, morphs };
}

test('video → VMD Full: two views synced, fused, face + fingers on a PMX, export, reload', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await boot(page);

  const modelChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await modelChooser).setFiles(MODEL);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);

  // Import: Full preset, front + side videos.
  await page.getByRole('tab', { name: /Video/ }).click();
  await page.getByTestId('v2v-capture-full').click();
  for (const f of ['twoView', 'face', 'fingers'])
    await expect(page.getByTestId(`v2v-feature-${f}`)).toBeChecked();
  await choose(page, 'v2v-choose-video', FRONT);
  await expect(page.getByTestId('v2v-info')).toContainText('640×360');
  await choose(page, 'v2v-choose-side', SIDE);
  await expect(page.getByTestId('v2v-side-info')).toContainText('4.4');
  await page.screenshot({ path: 'e2e/__shots/v2v-twoview-import.png' });

  // Detect both views → sync & calibration.
  await page.getByTestId('v2v-detect').click();
  await expect(page.getByTestId('v2v-sync')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('v2v-offset')).toContainText('audio', { timeout: 60_000 });
  const offsetMs = Number(
    (await page.getByTestId('v2v-offset').locator('b').textContent())!.replace(/[^\d.-]/g, ''),
  );
  expect(Math.abs(offsetMs - 400)).toBeLessThan(40);
  const cal = await page.getByTestId('v2v-calibration').textContent();
  expect(Math.abs(Number(cal!.split('°')[0]) - 90)).toBeLessThan(10);
  await expect(page.getByTestId('v2v-morph-table')).toContainText('まばたき');
  await page.screenshot({ path: 'e2e/__shots/v2v-twoview-sync.png' });

  // Retarget: report sections.
  await page.getByRole('button', { name: 'Continue' }).last().click();
  const report = page.getByTestId('v2v-report');
  await expect(report).toContainText('フェイスハンズ');
  await expect(page.getByTestId('v2v-report-twoview')).toContainText('Joints seen by both views');
  await expect(page.getByTestId('v2v-report-face')).toContainText('まばたき');
  await expect(page.getByTestId('v2v-report-hands')).toContainText('100% / 100%');

  // Preview: A/B and apply; fingers and face move on the model.
  await page.getByRole('button', { name: 'Continue' }).last().click();
  await expect(page.getByTestId('v2v-ab')).toBeVisible();
  // With the Clip Timeline open, the result lands as a Dance clip and a Face clip.
  await page.getByTestId('open-clips').click();
  await expect(page.getByTestId('clip-dock')).toBeVisible();
  await page.getByTestId('v2v-apply').click();
  await expect(page.getByTestId('v2v-applied')).toContainText('フェイスハンズ');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as W)
          .__clipTimeline!.get()
          .doc.tracks.map((t) => t.kind)
          .sort()
          .join(','),
      ),
    )
    .toBe('dance,face');
  await page.evaluate(() => (window as W).__studio!.pause());
  const id = await page.evaluate(() => (window as W).__studio!.listModels()[0]);
  const sample = async (frame: number) => {
    await page.evaluate((f) => (window as W).__studio!.seek(f), frame);
    await page.waitForTimeout(300);
    return page.evaluate((m) => {
      const s = (window as W).__studio!;
      const b = s.getBoneWorldPositions(m);
      const d = (a: string, c: string) => Math.hypot(...[0, 1, 2].map((i) => b[a][i] - b[c][i]));
      return { finger: d('左人指３', '左手首'), blink: s.getMorphWeights(m)['まばたき'] ?? 0 };
    }, id);
  };
  const open = await sample(16); // 0.53 s: open hand, mid-blink
  const fist = await sample(45); // 1.5 s: fist, eyes open
  expect(fist.finger).toBeLessThan(open.finger * 0.85);
  expect(open.blink).toBeGreaterThan(0.5);
  expect(fist.blink).toBeLessThan(0.2);
  await page.screenshot({ path: 'e2e/__shots/v2v-twoview-preview.png' });

  // Export: all parts, then body only.
  await page.getByRole('button', { name: 'Continue to export' }).click();
  await expect(page.getByTestId('v2v-parts')).toContainText('Face morphs');
  let download = page.waitForEvent('download');
  await page.getByTestId('v2v-download').click();
  const bytes = readFileSync(await (await download).path());
  expect(bytes.subarray(0, 25).toString('ascii')).toBe('Vocaloid Motion Data 0002');
  const vmd = readVmd(bytes);
  expect(vmd.bones.get('左人指２')).toBeGreaterThan(1);
  expect(vmd.bones.get('両目')).toBeGreaterThan(1);
  expect(vmd.morphs.get('まばたき')).toBeGreaterThan(1);
  expect(vmd.morphs.get('あ')).toBeGreaterThan(1);
  await page.getByTestId('v2v-part-face').uncheck();
  await page.getByTestId('v2v-part-fingers').uncheck();
  download = page.waitForEvent('download');
  await page.getByTestId('v2v-download').click();
  const bodyOnly = readVmd(readFileSync(await (await download).path()));
  expect(bodyOnly.morphs.size).toBe(0);
  expect(bodyOnly.bones.has('左人指２')).toBe(false);
  expect(bodyOnly.bones.has('センター')).toBe(true);

  // The exported file loads as a motion.
  await page.getByRole('tab', { name: 'studio' }).click();
  const motion = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add model or files' }).click();
  await (await motion).setFiles({ name: 'full.vmd', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.getByTestId('model-list')).toContainText('full.vmd', { timeout: 30_000 });

  // Reload: both views, settings and results come back.
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 30_000 });
  await page.reload();
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, { timeout: 90_000 });
  await page.getByRole('tab', { name: /Video/ }).click();
  await page
    .getByTestId('v2v-stepper')
    .getByRole('button', { name: /Retarget/ })
    .click();
  await expect(page.getByTestId('v2v-report-twoview')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('v2v-report-hands')).toBeVisible();
  await page
    .getByTestId('v2v-stepper')
    .getByRole('button', { name: /Import/ })
    .click();
  await expect(page.getByTestId('v2v-side-info')).toContainText('twoview-side.webm');
  expect(errors).toEqual([]);
});

for (const [name, device] of [
  ['phone', devices['Pixel 7']],
  ['tablet', devices['iPad (gen 7)']],
] as const) {
  test.describe(name, () => {
    const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = device;
    test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });
    test(`video → VMD Full preset is usable on ${name}`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await boot(page);
      if (name === 'phone') {
        await page.getByTestId('tab-bar').locator('[data-tab="more"]').click();
        await page.getByRole('button', { name: /Video to VMD/ }).click();
      } else {
        await page.getByRole('tab', { name: /Video/ }).click();
      }
      await expect(page.getByTestId('v2v-panel').first()).toBeVisible();
      await page.getByTestId('v2v-capture-full').click();
      await expect(page.getByText(/need a lot of memory and time/)).toBeVisible();
      await choose(page, 'v2v-choose-video', FRONT);
      await choose(page, 'v2v-choose-side', SIDE);
      await expect(page.getByTestId('v2v-side-info')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
        true,
      );
      await page.screenshot({ path: `e2e/__shots/v2v-twoview-${name}.png` });
      await page.getByTestId('v2v-detect').click();
      await expect(page.getByTestId('v2v-sync')).toBeVisible({ timeout: 150_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
        true,
      );
      await page.screenshot({ path: `e2e/__shots/v2v-twoview-${name}-sync.png` });
      expect(errors).toEqual([]);
    });
  });
}
