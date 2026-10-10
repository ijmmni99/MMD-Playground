import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';

// Model Editor on the procedural test humanoid (src/lib/model-edit/fixture.ts, GEN_FIXTURES=1) and a clothes
// donor with the same skeleton (a red jacket). No third-party models.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MODEL = [
  join(fixtures, 'EditTest/edittest.pmx'),
  join(fixtures, 'EditTest/tex/face.png'),
  join(fixtures, 'EditTest/tex/top.png'),
];
const DONOR = [join(fixtures, 'EditDonor/donor.pmx'), join(fixtures, 'EditDonor/tex/top.png')];

interface Studio {
  listModels(): string[];
  getBoneWorldPositions(id: string): Record<string, [number, number, number]>;
  pause(): void;
  seek(f: number): void;
}
interface Pmx {
  vertices: { position: [number, number, number] }[];
  materials: { name: string; diffuse: number[]; texture: number }[];
  bones: { name: string; position: [number, number, number] }[];
  morphs: { name: string; kind: string }[];
  rigidBodies: { name: string; mode: number; group: number; collidesWith: number }[];
  textures: string[];
}
interface Editor {
  state(): {
    modelId: string | null;
    building: boolean;
    version: number;
    builtVersion: number;
    result: { pmx: Pmx; hidden: number[] } | null;
  };
  ops(): { type: string }[];
}
type W = Window & { __studio?: Studio; __modelEditor?: Editor };

async function boot(page: Page): Promise<void> {
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  const q = page.getByLabel('Render quality');
  if (await q.isVisible().catch(() => false)) await q.selectOption('low');
}

async function loadModel(page: Page): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles(MODEL);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
}

/** Wait until the edited model in the scene matches the op list. */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = (window as W).__modelEditor!.state();
          return !s.building && s.builtVersion === s.version;
        }),
      { timeout: 60_000 },
    )
    .toBe(true);
}

const pmx = (page: Page) => page.evaluate(() => (window as W).__modelEditor!.state().result!.pmx);

/** Drag a Radix slider thumb to a fraction of its track. */
async function dragSlider(page: Page, testid: string, fraction: number): Promise<void> {
  const root = page.getByTestId(testid).getByRole('slider').first();
  const track = page.getByTestId(testid).locator('[data-orientation="horizontal"]').first();
  const box = (await track.boundingBox())!;
  const thumb = (await root.boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++)
    await page.mouse.move(
      box.x + (box.width * fraction * k) / 6 + (thumb.x - box.x) * (1 - k / 6),
      box.y + box.height / 2,
    );
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  await page.mouse.up();
}

test('model editor: hands, legs, outfit, recolour, group morph, clothes swap, undo, save, reload', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await boot(page);
  await loadModel(page);

  await page.getByRole('tab', { name: 'Model Editor' }).click();
  await expect(page.getByTestId('me-proportions')).toBeVisible({ timeout: 60_000 });
  await settled(page);
  const before = await pmx(page);
  const bi = (m: Pmx, n: string) => m.bones.findIndex((b) => b.name === n);
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // 1. Enlarge only the hands (drag the overall slider; L/R linked).
  await page.getByTestId('me-part-hand').click();
  await dragSlider(page, 'me-scale-overall', 0.6);
  await settled(page);
  let m = await pmx(page);
  const tip = (x: Pmx) => dist(x.bones[bi(x, '左中指３')].position, x.bones[bi(x, '左手首')].position);
  expect(tip(m) / tip(before)).toBeGreaterThan(1.2);
  expect(tip(m) / tip(before)).toBeCloseTo(
    dist(m.bones[bi(m, '右中指３')].position, m.bones[bi(m, '右手首')].position) / tip(before),
    3,
  );
  expect(m.bones[bi(m, '左ひじ')].position).toEqual(before.bones[bi(before, '左ひじ')].position);
  await page.screenshot({ path: 'e2e/__shots/me-hands.png' });

  // 2. Longer legs, feet planted.
  await page.getByTestId('me-part-upperLeg').click();
  await page.getByTestId('me-scale-length').getByRole('textbox').fill('1.3');
  await page.getByTestId('me-scale-length').getByRole('textbox').press('Enter');
  await page.getByTestId('me-part-lowerLeg').click();
  await page.getByTestId('me-scale-length').getByRole('textbox').fill('1.3');
  await page.getByTestId('me-scale-length').getByRole('textbox').press('Enter');
  await settled(page);
  m = await pmx(page);
  const minY = (x: Pmx) => Math.min(...x.vertices.map((v) => v.position[1]));
  expect(minY(m)).toBeCloseTo(minY(before), 3);
  expect(m.bones[bi(m, '下半身')].position[1]).toBeGreaterThan(
    before.bones[bi(before, '下半身')].position[1] + 2,
  );
  // The scene model has the new skeleton.
  const id = await page.evaluate(() => (window as W).__studio!.listModels()[0]);
  await page.evaluate(() => (window as W).__studio!.pause());
  const hipY = await page.evaluate(
    (mid) => (window as W).__studio!.getBoneWorldPositions(mid)['下半身'][1],
    id,
  );
  expect(hipY).toBeGreaterThan(before.bones[bi(before, '下半身')].position[1] + 2);

  // 3. Hide the skirt (its physics goes too).
  await page.getByTestId('me-tab-outfit').click();
  await page.getByTestId('me-toggle-bottom').click();
  await settled(page);
  m = await pmx(page);
  const skirt = m.materials.findIndex((x) => x.name === 'スカート');
  expect(m.materials[skirt].diffuse[3]).toBe(0);
  expect(m.rigidBodies.some((r) => /スカート/.test(r.name))).toBe(false);

  // 4. Recolour the top (diffuse) and swap its texture (recolour → new file).
  const top = m.materials.findIndex((x) => x.name === 'トップス');
  await page.getByTestId(`me-outfit-mat-${top}`).click();
  await page.getByTestId('me-diffuse').evaluate((el: HTMLInputElement) => {
    el.value = '#cc2233';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByTestId('me-recolor').getByRole('textbox', { name: 'Hue shift' }).fill('120');
  await page.getByTestId('me-recolor').getByRole('textbox', { name: 'Hue shift' }).press('Enter');
  await page.getByTestId('me-recolor-apply').click();
  await expect
    .poll(() =>
      page.evaluate(
        (t) => ((r) => r.textures[r.materials[t].texture])((window as W).__modelEditor!.state().result!.pmx),
        top,
      ),
    )
    .toMatch(/^tex\/edit\/top_recolor_/);
  await settled(page);
  m = await pmx(page);
  expect(m.materials[top].diffuse[0]).toBeCloseTo(0.8, 1);

  // 5. A group morph from two sliders.
  await page.getByTestId('me-tab-morphs').click();
  await page.getByTestId('me-morph-slider-まばたき').getByRole('textbox').fill('0.5');
  await page.getByTestId('me-morph-slider-まばたき').getByRole('textbox').press('Enter');
  await page.getByTestId('me-morph-slider-あ').getByRole('textbox').fill('0.3');
  await page.getByTestId('me-morph-slider-あ').getByRole('textbox').press('Enter');
  await page.getByTestId('me-group-name').fill('ウィンク笑顔');
  await page.getByTestId('me-create-group').click();
  await settled(page);
  m = await pmx(page);
  expect(m.morphs.find((x) => x.name === 'ウィンク笑顔')?.kind).toBe('group');

  // 6. Swap in a jacket from another model with the same skeleton.
  await page.getByTestId('me-tab-outfit').click();
  const donor = page.waitForEvent('filechooser');
  await page.getByTestId('me-load-donor').click();
  await (await donor).setFiles(DONOR);
  await expect(page.getByTestId('me-donor')).toBeVisible();
  await page.getByTestId('me-donor-mat-0').check();
  await page.getByTestId('me-license-ack').check();
  await page.getByTestId('me-merge').click();
  await settled(page);
  m = await pmx(page);
  const jacket = m.materials.findIndex((x) => x.name === 'ジャケット');
  expect(jacket).toBeGreaterThan(0);
  const r = await page.evaluate(() => (window as W).__modelEditor!.state().result!.hidden);
  expect(r).toContain(top); // the old top is hidden
  await page.screenshot({ path: 'e2e/__shots/me-outfit.png' });

  // 7. Undo / redo everything.
  const opsNow = (await page.evaluate(() => (window as W).__modelEditor!.ops())).length;
  for (let k = 0; k < 3; k++) await page.getByTestId('me-undo').click();
  await settled(page);
  expect((await pmx(page)).materials.some((x) => x.name === 'ジャケット')).toBe(false);
  for (let k = 0; k < 3; k++) await page.getByTestId('me-redo').click();
  await settled(page);
  expect((await page.evaluate(() => (window as W).__modelEditor!.ops())).length).toBe(opsNow);
  expect((await pmx(page)).materials.some((x) => x.name === 'ジャケット')).toBe(true);

  // 7b. One tap: hair / skirt collide with the body.
  await page.getByTestId('me-tab-physics').click();
  await page.getByTestId('me-body-collisions').click();
  await settled(page);
  expect((await page.evaluate(() => (window as W).__modelEditor!.ops())).at(-1)!.type).toBe('bodyCollisions');
  m = await pmx(page);
  // Body colliders share one group and collide with the physics parts (this outfit has none left after the
  // skirt swap, which applies after physics edits, so the colliders keep the skirt's group).
  const colliders = m.rigidBodies.filter((b) => b.mode === 0 && b.collidesWith);
  expect(colliders.length).toBeGreaterThan(8);
  expect(new Set(colliders.map((b) => b.group)).size).toBe(1);

  // 8. Save a PMX ZIP.
  await page.getByTestId('me-tab-info').click();
  await expect(page.getByTestId('me-checks-ok')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('me-save-zip').click();
  const zip = readFileSync(await (await download).path());
  expect(zip.subarray(0, 2).toString('ascii')).toBe('PK');
  const names = zip.toString('latin1');
  for (const f of ['model.pmx', 'README.txt', 'edit-report.json', 'tex/face.png', 'tex/Donor/'])
    expect(names).toContain(f);

  // 9. Reload: edits come back.
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 30_000 });
  await page.reload();
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, { timeout: 90_000 });
  await expect
    .poll(() => page.evaluate(() => (window as W).__studio!.listModels().length), { timeout: 60_000 })
    .toBe(1);
  await page.getByRole('tab', { name: 'Model Editor' }).click();
  await expect(page.getByTestId('me-proportions')).toBeVisible({ timeout: 60_000 });
  await settled(page);
  m = await pmx(page);
  expect(m.materials.some((x) => x.name === 'ジャケット')).toBe(true);
  expect(m.morphs.some((x) => x.name === 'ウィンク笑顔')).toBe(true);
  expect(tip(m) / tip(before)).toBeGreaterThan(1.2);
  await page.screenshot({ path: 'e2e/__shots/me-reloaded.png' });
  expect(errors).toEqual([]);
});

for (const [name, device] of [
  ['phone', devices['Pixel 7']],
  ['tablet', devices['iPad (gen 7)']],
] as const) {
  test.describe(name, () => {
    const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = device;
    test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });
    test(`model editor is usable on ${name}`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await boot(page);
      if (name === 'phone') {
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('tab-bar').locator('[data-tab="models"]').click();
        await page
          .getByRole('button', { name: /Add model/ })
          .first()
          .click();
        await (await chooser).setFiles(MODEL);
        await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
        await page.getByTestId('tab-bar').locator('[data-tab="more"]').click();
        await page.getByTestId('more-modeledit').click();
      } else {
        const chooser = page.waitForEvent('filechooser');
        if (!(await page.getByRole('button', { name: 'Add model or files' }).isVisible()))
          await page.getByRole('button', { name: 'Toggle left panel' }).click();
        await page.getByRole('button', { name: 'Add model or files' }).click();
        await (await chooser).setFiles(MODEL);
        await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
        await page.getByRole('tab', { name: /Edit/ }).click();
      }
      await expect(page.getByTestId('me-proportions')).toBeVisible({ timeout: 60_000 });
      await settled(page);
      await page.getByTestId('me-part-head').click();
      await page.getByRole('button', { name: 'Increase Overall' }).click();
      await settled(page);
      expect(await page.evaluate(() => (window as W).__modelEditor!.ops().length)).toBe(1);
      const sizes = await page.getByTestId('me-part-head').boundingBox();
      expect(sizes!.height).toBeGreaterThanOrEqual(43);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
        true,
      );
      await page.screenshot({ path: `e2e/__shots/me-${name}.png` });
      expect(errors).toEqual([]);
    });
  });
}
