import { expect, test, type Page } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLayoutMode } from '../src/lib/layoutMode';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const modelFiles = ['Blocky/blocky.pmx', 'Blocky/tex/skin.png', 'Blocky/tex/hair.png'].map((f) =>
  join(fixtures, f),
);

interface StudioHandle {
  listModels(): string[];
  getPlayback(): { frame: number; playing: boolean; duration: number };
  getCameraState(): { alpha: number; beta: number; radius: number };
}
declare global {
  interface Window {
    __studio?: StudioHandle;
  }
}

/** Boot and report whether the 3D engine started (headless WebKit may lack WebGL2). */
async function boot(page: Page): Promise<boolean> {
  // Playwright's touch emulation reports a single touch point; real phones report 5+.
  // Babylon sizes its touch slots from this, so emulate a real multi-touch screen.
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 }),
  );
  // ?engine=1 boots the 3D engine right away instead of on first interaction.
  await page.goto('/?engine=1');
  const started = await page
    .waitForFunction(
      () => window.__studio !== undefined || document.querySelector('[role="alert"]') !== null,
      null,
      {
        timeout: 90_000,
        polling: 500,
      },
    )
    .then(() => page.evaluate(() => window.__studio !== undefined));
  return started;
}

/** Elements with the test id that a finger could actually tap (visible, in viewport, not covered). */
async function tappable(page: Page, testId: string) {
  const out = [];
  for (const el of await page.getByTestId(testId).all()) {
    const hit = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
      const top = document.elementFromPoint(x, y);
      return !!top && (top === node || node.contains(top));
    });
    if (hit) out.push(el);
  }
  return out;
}

async function isOnScreen(page: Page, testId: string): Promise<boolean> {
  return (await tappable(page, testId)).length > 0;
}

/** First element with the test id that can actually be tapped. */
async function onScreen(page: Page, testId: string) {
  await expect.poll(() => isOnScreen(page, testId), { timeout: 30_000 }).toBe(true);
  return (await tappable(page, testId))[0];
}

function expectedShell(page: Page): string {
  const vp = page.viewportSize()!;
  const mode = computeLayoutMode(vp.width, vp.height);
  return { phone: 'phone-shell', 'phone-landscape': 'landscape-shell', tablet: 'tablet-shell', desktop: '' }[
    mode
  ];
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Synthetic touch pointers on the canvas (Babylon listens to pointer events). */
async function touchGesture(page: Page, tracks: { x: number; y: number }[][]): Promise<void> {
  await page.evaluate(async (paths) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="viewport-canvas"]')!;
    const r = canvas.getBoundingClientRect();
    const fire = (type: string, id: number, p: { x: number; y: number }) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 10 + id,
          pointerType: 'touch',
          isPrimary: id === 0,
          clientX: r.left + p.x,
          clientY: r.top + p.y,
          bubbles: true,
          cancelable: true,
          buttons: type === 'pointerup' ? 0 : 1,
          button: type === 'pointermove' ? -1 : 0,
        }),
      );
    const frame = () => new Promise((res) => requestAnimationFrame(res));
    paths.forEach((path, id) => fire('pointerdown', id, path[0]));
    await frame();
    const steps = paths[0].length;
    for (let s = 1; s < steps; s++) {
      paths.forEach((path, id) => fire('pointermove', id, path[s]));
      await frame();
    }
    paths.forEach((path, id) => fire('pointerup', id, path[steps - 1]));
  }, tracks);
}

test('layout, navigation, touch camera, file loading and transport', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebGL|webgl|GPU/i.test(m.text())) errors.push(m.text());
  });

  const engine = await boot(page);
  const shell = expectedShell(page);
  if (shell) await expect(page.getByTestId(shell)).toBeVisible();
  await noHorizontalOverflow(page);

  // ---- panel navigation for this layout
  if (shell === 'phone-shell') {
    const sheet = page.getByTestId('bottom-sheet');
    await expect(sheet).toHaveAttribute('data-snap', 'closed');
    await page.getByTestId('tab-bar').locator('[data-tab="scene"]').click();
    await expect(sheet).toHaveAttribute('data-snap', 'half');
    await expect(page.getByTestId('tab-bar').locator('[data-tab="scene"]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await page.getByRole('button', { name: 'Expand panel' }).click();
    await expect(sheet).toHaveAttribute('data-snap', 'full');
    await page.getByTestId('tab-bar').locator('[data-tab="more"]').click();
    await expect(page.getByTestId('more-menu')).toBeVisible();
    await page.getByTestId('tab-bar').locator('[data-tab="more"]').click();
    await expect(sheet).toHaveAttribute('data-snap', 'closed');
  } else if (shell === 'landscape-shell') {
    await page.getByTestId('tab-bar').locator('[data-tab="scene"]').click();
    await expect(page.getByTestId('side-panel')).toContainText('Directional light');
    await page.getByTestId('tab-bar').locator('[data-tab="models"]').click();
    await expect(page.getByTestId('side-panel')).toContainText('Add model');
  } else if (shell === 'tablet-shell') {
    await expect(page.getByTestId('drawer-left')).toHaveAttribute('data-open', 'false');
    await page.getByRole('button', { name: 'Toggle left panel' }).click();
    await expect(page.getByTestId('drawer-left')).toHaveAttribute('data-open', 'true');
    await page.getByRole('button', { name: 'Close Scene panel' }).click();
    await expect(page.getByTestId('drawer-left')).toHaveAttribute('data-open', 'false');
  }
  await noHorizontalOverflow(page);

  test.skip(!engine, 'WebGL2 is unavailable in this headless browser; layout checks passed.');

  // ---- load a model through the file input ("Add model" button)
  const chooser = page.waitForEvent('filechooser');
  if (shell === 'tablet-shell') {
    // The drawer opens over the welcome card: wait for it, then use its own button.
    await page.getByRole('button', { name: 'Toggle left panel' }).click();
    const drawer = page.getByTestId('drawer-left');
    await expect(drawer).toHaveAttribute('data-open', 'true');
    await drawer.getByTestId('add-model').click();
  } else {
    // Several "Add model" buttons may exist (welcome card + scene panel); use one actually on screen.
    await (await onScreen(page, 'add-model')).click();
  }
  await (await chooser).setFiles(modelFiles);
  await expect
    .poll(() => page.evaluate(() => window.__studio!.listModels().length), { timeout: 90_000 })
    .toBe(1);

  const chooser2 = page.waitForEvent('filechooser');
  if (shell === 'phone-shell') await page.getByTestId('tab-bar').locator('[data-tab="models"]').click();
  if (shell === '' && !(await isOnScreen(page, 'add-motion'))) {
    // Desktop layout on a touch device (iPad landscape): the scene panel starts collapsed < 1100 px.
    await page.getByRole('button', { name: 'Toggle left panel' }).click();
  }
  await (await onScreen(page, 'add-motion')).click();
  await (await chooser2).setFiles([join(fixtures, 'dance.vmd')]);
  await expect
    .poll(() => page.evaluate(() => window.__studio!.getPlayback().duration), { timeout: 60_000 })
    .toBeGreaterThan(200);
  if (shell === 'phone-shell') await page.getByRole('button', { name: /^Close Models panel/ }).click();
  if (shell === 'tablet-shell') await page.getByRole('button', { name: 'Close Scene panel' }).click();
  if (shell === 'landscape-shell') await page.getByRole('button', { name: 'Collapse panel' }).click();

  // ---- touch: one-finger drag orbits, two-finger pinch zooms
  const cam = () => page.evaluate(() => window.__studio!.getCameraState());
  const box = (await page.getByTestId('viewport-canvas').boundingBox())!;
  const cx = box.width / 2;
  const cy = box.height / 2;
  const before = await cam();
  await touchGesture(page, [Array.from({ length: 8 }, (_, i) => ({ x: cx - 60 + i * 20, y: cy }))]);
  await expect
    .poll(async () => Math.abs((await cam()).alpha - before.alpha), { timeout: 20_000 })
    .toBeGreaterThan(0.01);
  const beforePinch = await cam();
  await touchGesture(page, [
    Array.from({ length: 8 }, (_, i) => ({ x: cx - 20 - i * 12, y: cy })),
    Array.from({ length: 8 }, (_, i) => ({ x: cx + 20 + i * 12, y: cy })),
  ]);
  await expect.poll(async () => (await cam()).radius, { timeout: 20_000 }).toBeLessThan(beforePinch.radius);

  // ---- transport
  await page.getByTestId('play-toggle').first().click();
  await expect
    .poll(() => page.evaluate(() => window.__studio!.getPlayback().frame), { timeout: 60_000 })
    .toBeGreaterThan(5);
  await page.getByTestId('play-toggle').first().click();
  await expect.poll(() => page.evaluate(() => window.__studio!.getPlayback().playing)).toBe(false);

  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
