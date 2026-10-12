import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PMX = join(fixtures, 'Mannequin/mannequin.pmx');
const DANCE = join(fixtures, 'Mannequin/mannequin-dance.vmd');
const CAMERA = join(fixtures, 'Mannequin/mannequin-camera.vmd');
const BEAT = join(fixtures, 'beat.wav');

interface Doc {
  tracks: { id: string; kind: string; name: string; modelId?: string }[];
  clips: { id: string; trackId: string; startFrame: number; sourceIn: number; sourceOut: number }[];
}
type W = Window & {
  __studio?: {
    listModels(): string[];
    seek(f: number): void;
    getPlayback(): { duration: number };
    getExtraAudioStatus(): { layers: number; decoded: number; scheduled: number };
  };
  __clipTimeline?: { get(): { doc: Doc }; set(p: Record<string, unknown>): void };
};

const doc = (page: Page): Promise<Doc> => page.evaluate(() => (window as W).__clipTimeline!.get().doc);
const rows = async (page: Page): Promise<string[]> =>
  (await doc(page)).tracks.filter((t) => t.kind === 'dance').map((t) => t.id);

async function dragClip(
  page: Page,
  id: string,
  to: (area: DOMRect) => { x: number; y: number },
): Promise<void> {
  await page.locator(`[data-clip-id="${id}"]`).scrollIntoViewIfNeeded();
  const box = (await page.locator(`[data-clip-id="${id}"]`).boundingBox())!;
  const area = await page.getByTestId('clip-area').evaluate((el) => el.getBoundingClientRect().toJSON());
  const from = { x: box.x + Math.min(30, box.width / 2), y: box.y + box.height / 2 };
  const hit = await page.evaluate(
    ({ x, y }) =>
      (document.elementFromPoint(x, y)?.closest('[data-clip-id]') as HTMLElement | null)?.dataset.clipId,
    from,
  );
  expect(hit).toBe(id);
  const end = to(area as DOMRect);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + end.x) / 2, (from.y + end.y) / 2, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await expect(page.getByTestId('drop-row')).toBeVisible();
  await page.mouse.up();
}

test('cut a dance, drag one piece below or above to make new rows, and playback follows the layers', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  await page.getByLabel('Render quality').selectOption('low');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles([PMX, DANCE]);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  await page.getByTestId('open-clips').click();
  await expect.poll(() => page.evaluate(() => !!(window as W).__clipTimeline)).toBe(true);
  await expect.poll(async () => (await doc(page)).clips.length).toBe(1);

  // Cut in the middle (S at the playhead).
  const whole = (await doc(page)).clips[0];
  const cut = Math.round((whole.sourceOut - whole.sourceIn) / 2);
  await page.evaluate((f) => (window as W).__studio!.seek(f), cut);
  await page.getByTestId('clip-dock').hover();
  await page.keyboard.press('s');
  await expect.poll(async () => (await doc(page)).clips.length).toBe(2);
  await page.evaluate(() => (window as W).__clipTimeline!.set({ ppf: 1.5 }));
  await page.getByTestId('ct-snap').click();
  const [first, second] = [...(await doc(page)).clips].sort((a, b) => a.startFrame - b.startFrame);
  expect(await rows(page)).toHaveLength(1);

  // Drag the second piece into the empty space below the last row: a new row appears.
  await dragClip(page, second.id, (a) => ({ x: a.left + 200, y: a.bottom - 6 }));
  await expect.poll(async () => (await rows(page)).length).toBe(2);
  let d = await doc(page);
  const lower = d.tracks.filter((t) => t.kind === 'dance')[1];
  expect(lower.modelId).toBe(d.tracks.find((t) => t.kind === 'dance')!.modelId);
  expect(d.clips.find((c) => c.id === second.id)!.trackId).toBe(lower.id);
  expect(d.clips.find((c) => c.id === first.id)!.trackId).not.toBe(lower.id);

  // Drag the first piece over the ruler: a new row on top. The emptied row goes away.
  await dragClip(page, first.id, (a) => ({ x: a.left + 120, y: a.top + 8 }));
  await expect.poll(async () => (await rows(page)).length).toBe(2);
  d = await doc(page);
  const dance = d.tracks.filter((t) => t.kind === 'dance');
  expect(d.clips.find((c) => c.id === first.id)!.trackId).toBe(dance[0].id);
  expect(d.clips.find((c) => c.id === second.id)!.trackId).toBe(dance[1].id);

  // Both rows are on screen as separate rows, and the timeline keeps its length.
  await expect(page.locator(`[data-track-id="${dance[0].id}"] [data-clip-id="${first.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-track-id="${dance[1].id}"] [data-clip-id="${second.id}"]`)).toBeVisible();
  expect(await page.evaluate(() => (window as W).__studio!.getPlayback().duration)).toBeGreaterThan(
    whole.sourceOut - whole.sourceIn - 2,
  );

  // Undo puts the piece back (one step for the move).
  await page.getByTestId('ct-undo').click();
  await expect.poll(async () => (await rows(page)).length).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('camera and audio clips can be dragged to new rows too; a moved music clip plays as an extra sound', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Tall enough that every row and the spare row below them are on screen.
  await page.setViewportSize({ width: 1280, height: 1300 });
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  await page.getByLabel('Render quality').selectOption('low');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles([PMX, DANCE, CAMERA, BEAT]);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  await page.getByTestId('open-clips').click();
  await expect.poll(() => page.evaluate(() => !!(window as W).__clipTimeline)).toBe(true);
  const kinds = async (kind: string): Promise<string[]> =>
    (await doc(page)).tracks.filter((t) => t.kind === kind).map((t) => t.id);
  await expect.poll(async () => (await kinds('camera')).length).toBe(1);
  await expect.poll(async () => (await kinds('audio')).length).toBe(1);
  await page.evaluate(() => (window as W).__clipTimeline!.set({ ppf: 1.5 }));
  await page.getByTestId('ct-snap').click();

  // Two audio rows (music + an extra sound). Dragging the extra clip below makes a fresh row for it.
  await page.getByTestId('ct-add').click();
  const extraChooser = page.waitForEvent('filechooser');
  await page.getByTestId('ct-add-extra-audio').click();
  await (await extraChooser).setFiles([BEAT]);
  await expect.poll(async () => (await kinds('audio')).length).toBe(2);
  const oldRows = await kinds('audio');
  const extraClip = (await doc(page)).clips.find((c) => c.trackId === oldRows[1])!.id;
  await dragClip(page, extraClip, (a) => ({ x: a.left + 200, y: a.bottom - 6 }));
  await expect
    .poll(async () => (await doc(page)).clips.find((c) => c.id === extraClip)!.trackId)
    .not.toBe(oldRows[1]);
  const movedTo = (await doc(page)).clips.find((c) => c.id === extraClip)!.trackId;
  expect(oldRows).not.toContain(movedTo);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.getExtraAudioStatus().decoded)).toBe(1);

  // Camera: cut the clip, then drag a piece below. Two camera rows.
  await page.evaluate(() => (window as W).__studio!.seek(60));
  await page.getByTestId('clip-dock').hover();
  await page.keyboard.press('s');
  const camRow = (await kinds('camera'))[0];
  await expect
    .poll(async () => (await doc(page)).clips.filter((c) => c.trackId === camRow).length)
    .toBeGreaterThanOrEqual(2);
  const camPieces = (await doc(page)).clips
    .filter((c) => c.trackId === camRow)
    .sort((a, b) => a.startFrame - b.startFrame);
  await dragClip(page, camPieces[camPieces.length - 1].id, (a) => ({ x: a.left + 200, y: a.bottom - 6 }));
  await expect.poll(async () => (await kinds('camera')).length).toBe(2);
  expect(errors).toEqual([]);
});

test('"Put on a new row" adds each new dance as its own layer at the playhead', async ({ page }) => {
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  await page.getByLabel('Render quality').selectOption('low');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles([PMX, DANCE]);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  await page.getByTestId('open-clips').click();
  await expect.poll(() => page.evaluate(() => !!(window as W).__clipTimeline)).toBe(true);
  await expect.poll(async () => (await doc(page)).clips.length).toBe(1);

  await page.evaluate(() => (window as W).__studio!.seek(30));
  await page.getByTestId('ct-add').click();
  await page.getByTestId('ct-new-row').check();
  const second = page.waitForEvent('filechooser');
  await page.getByTestId('ct-add-motion').click();
  await (await second).setFiles([join(fixtures, 'dance.vmd')]);
  await expect.poll(async () => (await rows(page)).length).toBe(2);
  const d = await doc(page);
  const top = d.tracks.filter((t) => t.kind === 'dance')[0];
  expect(d.clips.find((c) => c.trackId === top.id)!.startFrame).toBe(30);
});
