import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PMX = join(fixtures, 'NameTest/nametest.pmx');
const DANCE = join(fixtures, 'Mannequin/mannequin-dance.vmd');

type W = Window & { __studio?: { listModels(): string[] } };

async function load(page: Page, files: string[] = [PMX]): Promise<void> {
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: /Open files \/ ZIP…|Upload ZIP or files…|^Add model/ })
    .first()
    .click();
  await (await chooser).setFiles(files);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
}

test('english labels: panels, display modes, bilingual search', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await load(page, [PMX, DANCE]);
  const insp = page.getByTestId('model-inspector');

  // Morphs: dictionary, PMX English name, original; dictionary category regroups ウィンク右 under Eyes.
  await expect(insp.getByText('Blink (まばたき)')).toBeVisible();
  await expect(insp.getByText('Odd Morph (謎モーフ)')).toBeVisible();
  await expect(insp.locator('[data-ja="ほげ"]')).toHaveText('ほげ');
  await expect(insp.locator('[data-ja="謎モーフ"]')).toHaveAttribute('data-name-source', 'pmx');
  await expect(insp.locator('[data-ja="ほげ"]')).toHaveAttribute('title', /ほげ · original name/);

  // Bones: dictionary and pattern (marked as a guess), tooltip with the source.
  await insp.getByRole('button', { name: /^Bones/ }).click();
  await insp.getByLabel(/Search bones/).fill('hair');
  const hair = insp.locator('[data-ja="左髪先"]');
  await expect(hair).toContainText('Left Hair Tip (左髪先)');
  await expect(hair).toHaveAttribute('data-name-source', 'pattern');
  await expect(hair).toHaveAttribute('title', '左髪先 → Left Hair Tip · guessed from the name');
  // Search: Japanese, katakana for hiragana, full-width, case-insensitive.
  for (const [q, ja] of [
    ['ひじ', '左ひじ'],
    ['ヒジ', '左ひじ'],
    ['ＬＥＧ ＩＫ', '左足ＩＫ'],
    ['mystery', '謎ボーン'],
  ]) {
    await insp.getByLabel(/Search bones/).fill(q);
    await expect(insp.locator(`[data-ja="${ja}"]`)).toBeVisible();
  }
  await insp.getByLabel(/Search bones/).fill('');
  await insp.getByRole('button', { name: /^Materials/ }).click();
  await expect(insp.getByText('Skin (肌)')).toBeVisible();

  // Timeline rows.
  await page.getByRole('button', { name: /Expand ネームテスト/ }).click();
  await page.getByRole('button', { name: /Expand Bones/ }).click();
  await expect(page.locator('[data-ja="上半身"]').first()).toContainText('Upper Body');
  await page.screenshot({ path: 'e2e/__shots/names-desktop.png' });

  // Display modes apply everywhere at once.
  const display = insp.getByTestId('name-display');
  await display.getByRole('radio', { name: 'EN' }).click();
  await expect(insp.getByText('Skin', { exact: true })).toBeVisible();
  await expect(page.locator('[data-ja="上半身"]').first()).toHaveText('Upper Body');
  await display.getByRole('radio', { name: '日本語' }).click();
  await expect(insp.locator('[data-ja="肌"]')).toHaveText('肌');
  await expect(page.locator('[data-ja="上半身"]').first()).toHaveText('上半身');
  // The setting persists across reloads.
  await page.reload();
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, { timeout: 90_000 });
  await expect(page.getByTestId('name-display').getByRole('radio', { name: '日本語' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByTestId('name-display').getByRole('radio', { name: 'Both' }).click();
  expect(errors).toEqual([]);
});

test('rename a label, reset, and keep it across reloads (motion still plays)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await load(page, [PMX, DANCE]);
  const insp = page.getByTestId('model-inspector');
  await insp.getByRole('button', { name: /^Bones/ }).click();
  await insp.getByLabel(/Search bones/).fill('左腕');
  const arm = insp.locator('[data-ja="左腕"]');
  await expect(arm).toContainText('Left Arm (左腕)');

  // Right-click → Rename label.
  await arm.click({ button: 'right' });
  await page.getByTestId('name-menu').getByRole('menuitem', { name: 'Rename label…' }).click();
  const dialog = page.getByTestId('rename-label');
  await dialog.getByLabel('English label').fill('Port Arm');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(arm).toContainText('Port Arm (左腕)');
  await expect(arm).toHaveAttribute('data-name-source', 'override');
  // Search finds the custom label too.
  await insp.getByLabel(/Search bones/).fill('port');
  await expect(arm).toBeVisible();

  // A morph label and its reset.
  const blink = insp.locator('[data-ja="まばたき"]');
  await blink.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename label…' }).click();
  await page.getByTestId('rename-label').getByLabel('English label').fill('Close Eyes');
  await page.getByTestId('rename-label').getByRole('button', { name: 'Save' }).click();
  await expect(blink).toContainText('Close Eyes');
  await blink.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reset label' }).click();
  await expect(blink).toContainText('Blink (まばたき)');

  // Reload: the label is restored with the project; the motion still drives the Japanese-named bones.
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 30_000 });
  await page.reload();
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  const insp2 = page.getByTestId('model-inspector');
  await insp2.getByRole('button', { name: /^Bones/ }).click();
  await insp2.getByLabel(/Search bones/).fill('arm');
  await expect(insp2.locator('[data-ja="左腕"]')).toContainText('Port Arm (左腕)');
  await expect(insp2.locator('[data-ja="まばたき"]')).toContainText('Blink (まばたき)');
  const moves = await page.evaluate(async () => {
    const st = (
      window as unknown as {
        __studio: {
          listModels(): string[];
          seek(f: number): void;
          getBoneWorldPositions(id: string): Record<string, number[]>;
        };
      }
    ).__studio;
    const id = st.listModels()[0];
    st.seek(0);
    await new Promise((r) => setTimeout(r, 300));
    const a = st.getBoneWorldPositions(id)['左ひじ'];
    st.seek(15);
    await new Promise((r) => setTimeout(r, 300));
    const b = st.getBoneWorldPositions(id)['左ひじ'];
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  });
  expect(moves).toBeGreaterThan(0.05);
  await page.screenshot({ path: 'e2e/__shots/names-renamed.png' });
  expect(errors).toEqual([]);
});

test.describe('phone', () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['Pixel 7'];
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

  test('labels truncate cleanly and long-press opens the rename dialog', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await load(page);
    await page.getByTestId('tab-bar').locator('[data-tab="inspector"]').click();
    const insp = page.getByTestId('model-inspector');
    await expect(insp.getByText('Blink (まばたき)')).toBeVisible();
    const sw = insp.getByTestId('name-display').getByRole('radio', { name: 'EN' });
    expect((await sw.boundingBox())!.height).toBeGreaterThanOrEqual(36);
    await insp.getByRole('button', { name: /^Bones/ }).click();
    await insp.getByLabel(/Search bones/).fill('スカート');
    const skirt = insp.locator('[data-ja="右スカート前２"]');
    await expect(skirt).toContainText('Right Skirt Front 2');
    const row = (await skirt.boundingBox())!;
    expect(row.height).toBeGreaterThanOrEqual(16);
    // Long-press → name menu → rename.
    await skirt.scrollIntoViewIfNeeded();
    const box = (await skirt.boundingBox())!;
    const cx = box.x + Math.min(40, box.width / 2);
    const cy = box.y + box.height / 2;
    await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y)!;
        if (!el.closest('[data-ja]')) throw new Error(`long-press target is ${el.tagName}.${el.className}`);
        const ev = (type: string) =>
          new PointerEvent(type, {
            bubbles: true,
            clientX: x,
            clientY: y,
            pointerType: 'touch',
            pointerId: 7,
            isPrimary: true,
          });
        el.dispatchEvent(ev('pointerdown'));
        setTimeout(() => el.dispatchEvent(ev('pointerup')), 700);
      },
      { x: cx, y: cy },
    );
    await expect(page.getByTestId('name-menu')).toBeVisible();
    const item = page.getByRole('menuitem', { name: 'Rename label…' });
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await item.click();
    await page.getByTestId('rename-label').getByLabel('English label').fill('Front Skirt R2');
    await page.getByTestId('rename-label').getByRole('button', { name: 'Save' }).click();
    await expect(skirt).toContainText('Front Skirt R2');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: 'e2e/__shots/names-phone.png' });
    expect(errors).toEqual([]);
  });
});
