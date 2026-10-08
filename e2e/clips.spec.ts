import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PMX = join(fixtures, 'Mannequin/mannequin.pmx');
const DANCE = join(fixtures, 'Mannequin/mannequin-dance.vmd');
const DANCE2 = join(fixtures, 'dance.vmd');
const CAMERA = join(fixtures, 'Mannequin/mannequin-camera.vmd');

interface Studio {
  listModels(): string[];
  getPlayback(): { frame: number; playing: boolean; duration: number };
  seek(f: number): void;
}
interface ClipLite {
  id: string;
  trackId: string;
  startFrame: number;
  sourceIn: number;
  sourceOut: number;
  speed: number;
  loopCount: number;
  text?: { content: string };
}
interface Doc {
  tracks: { id: string; kind: string }[];
  clips: ClipLite[];
  sources: { id: string }[];
}
interface CT {
  get(): { doc: Doc; selection: string[]; open: boolean };
  set(p: Record<string, unknown>): void;
}
type W = Window & { __studio?: Studio; __clipTimeline?: CT };

const doc = (page: Page): Promise<Doc> => page.evaluate(() => (window as W).__clipTimeline!.get().doc);
const kindClips = async (page: Page, kind: string): Promise<ClipLite[]> => {
  const d = await doc(page);
  const ids = new Set(d.tracks.filter((t) => t.kind === kind).map((t) => t.id));
  return d.clips.filter((c) => ids.has(c.trackId)).sort((a, b) => a.startFrame - b.startFrame);
};

async function boot(page: Page): Promise<void> {
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, { timeout: 90_000, polling: 500 });
  await page.getByLabel('Render quality').selectOption('low');
}

async function openFiles(page: Page, files: string[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open files \/ ZIP…|Upload ZIP or files…|^Add model/ }).first().click();
  await (await chooser).setFiles(files);
}

async function addViaMenu(page: Page, item: string, files: string[]): Promise<void> {
  await page.getByTestId('ct-add').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(item).click();
  await (await chooser).setFiles(files);
}

/** Drag from a point by dx (mouse, in steps). */
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy = 0): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

test('clip timeline: add, split, duplicate, move, trim, reorder, camera, undo, persist', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await boot(page);
  await openFiles(page, [PMX]);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);

  await page.getByTestId('open-clips').click();
  await expect(page.getByTestId('clip-dock')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as W).__clipTimeline)).toBe(true);

  // Two dances land back to back on the model's dance track.
  await addViaMenu(page, 'ct-add-motion', [DANCE, DANCE2]);
  await expect.poll(async () => (await kindClips(page, 'dance')).length).toBe(2);
  let dance = await kindClips(page, 'dance');
  expect(dance[0].startFrame).toBe(0);
  const len0 = dance[0].sourceOut - dance[0].sourceIn;
  expect(dance[1].startFrame).toBe(len0);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.getPlayback().duration)).toBeGreaterThanOrEqual(
    len0 + dance[1].sourceOut - dance[1].sourceIn - 1,
  );

  // Split the first clip at the playhead (S).
  const cut = Math.round(len0 / 2);
  await page.evaluate((f) => (window as W).__studio!.seek(f), cut);
  await page.getByTestId('clip-dock').hover();
  await page.keyboard.press('s');
  await expect.poll(async () => (await kindClips(page, 'dance')).length).toBe(3);
  dance = await kindClips(page, 'dance');
  expect(dance[1].startFrame).toBe(cut);
  expect(dance[1].sourceIn).toBe(cut);

  // Tap to select, Ctrl+D duplicates.
  const firstEl = page.locator(`[data-clip-id="${dance[0].id}"]`);
  await firstEl.click();
  await expect.poll(() => page.evaluate(() => (window as W).__clipTimeline!.get().selection)).toEqual([dance[0].id]);
  await page.keyboard.press('Control+d');
  await expect.poll(async () => (await kindClips(page, 'dance')).length).toBe(4);

  // Undo / redo through the big buttons.
  await page.getByTestId('ct-undo').click();
  await expect.poll(async () => (await kindClips(page, 'dance')).length).toBe(3);
  await page.getByTestId('ct-redo').click();
  await expect.poll(async () => (await kindClips(page, 'dance')).length).toBe(4);

  // Drag the last clip right (snap off so it lands where dropped; zoomed out so it is on screen).
  await page.getByTestId('ct-snap').click();
  await page.evaluate(() => (window as W).__clipTimeline!.set({ ppf: 1.2 }));
  dance = await kindClips(page, 'dance');
  const last = dance[dance.length - 1];
  const box = (await page.locator(`[data-clip-id="${last.id}"]`).boundingBox())!;
  const hit = await page.evaluate(
    ({ x, y }) => (document.elementFromPoint(x, y)?.closest('[data-clip-id]') as HTMLElement | null)?.dataset.clipId,
    { x: box.x + Math.min(30, box.width / 2), y: box.y + box.height / 2 },
  );
  expect(hit).toBe(last.id);
  await drag(page, { x: box.x + Math.min(30, box.width / 2), y: box.y + box.height / 2 }, 80);
  await expect
    .poll(async () => (await kindClips(page, 'dance')).find((c) => c.id === last.id)!.startFrame)
    .toBeGreaterThan(last.startFrame + 5);

  // Trim its end edge left.
  const moved = (await kindClips(page, 'dance')).find((c) => c.id === last.id)!;
  const handle = page.locator(`[data-clip-id="${last.id}"] [data-trim="end"]`);
  await page.locator(`[data-clip-id="${last.id}"]`).click();
  const hb = (await handle.boundingBox())!;
  await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, -40);
  await expect
    .poll(async () => (await kindClips(page, 'dance')).find((c) => c.id === last.id)!.sourceOut)
    .toBeLessThan(moved.sourceOut);

  // Toolbar: retime and loop.
  await page.getByTestId('ct-speed').click();
  await page.getByRole('button', { name: '2×', exact: true }).click();
  await expect.poll(async () => (await kindClips(page, 'dance')).find((c) => c.id === last.id)!.speed).toBe(2);
  await page.keyboard.press('Escape');

  // Camera clip goes on the camera track.
  await addViaMenu(page, 'ct-add-motion', [CAMERA]);
  await expect.poll(async () => (await kindClips(page, 'camera')).length).toBe(1);

  // Face preset.
  await page.getByTestId('ct-add').click();
  await page.getByTestId('ct-add-face-blink').click();
  await expect.poll(async () => (await kindClips(page, 'face')).length).toBe(1);

  await page.screenshot({ path: 'e2e/__shots/clips-desktop.png' });

  // Playback runs through the baked timeline.
  await page.getByTestId('play-toggle').click();
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.getPlayback().frame), { timeout: 20_000 }).toBeGreaterThan(cut + 5);
  await page.getByTestId('play-toggle').click();

  // Reload: the timeline is restored from the autosaved project.
  const before = await doc(page);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 30_000 });
  await page.reload();
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  await page.getByTestId('open-clips').click();
  await expect.poll(() => page.evaluate(() => !!(window as W).__clipTimeline)).toBe(true);
  await expect.poll(async () => (await doc(page)).clips.length).toBe(before.clips.length);
  expect((await doc(page)).clips).toEqual(before.clips);
  expect(errors).toEqual([]);
});
