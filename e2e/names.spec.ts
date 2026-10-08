import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

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
