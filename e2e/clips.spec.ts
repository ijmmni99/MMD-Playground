import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PMX = join(fixtures, 'Mannequin/mannequin.pmx');
const DANCE = join(fixtures, 'Mannequin/mannequin-dance.vmd');
const DANCE2 = join(fixtures, 'dance.vmd');
const CAMERA = join(fixtures, 'Mannequin/mannequin-camera.vmd');
const LYRICS = join(fixtures, 'lyrics.srt');

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
  tracks: { id: string; kind: string; name: string }[];
  clips: ClipLite[];
  sources: { id: string; name: string }[];
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

  // Advanced: double-click a dance clip → keyframe editor on that clip → key a pose → back to clips.
  const first = (await kindClips(page, 'dance'))[0];
  await page.locator(`[data-clip-id="${first.id}"]`).dblclick();
  await expect(page.getByTestId('dope-sheet')).toBeVisible();
  await expect(page.getByTestId('back-to-clips')).toBeVisible();
  await page.evaluate((f) => (window as W).__studio!.seek(f), first.startFrame + 5);
  await page.getByTestId('dope-sheet').hover();
  await page.keyboard.press('k');
  await page.getByTestId('back-to-clips').click();
  await expect(page.getByTestId('clip-dock')).toBeVisible();
  await expect
    .poll(async () => {
      const d = await doc(page);
      const c = d.clips.find((x) => x.id === first.id)!;
      return d.sources.find((x) => x.id === (c as unknown as { sourceId: string }).sourceId)?.name;
    })
    .toMatch(/\(edited\)\.vmd$/);
  await page.getByTestId('ct-undo').click();
  await expect
    .poll(async () => ((await doc(page)).clips.find((x) => x.id === first.id) as unknown as { sourceId: string }).sourceId)
    .toBe((first as unknown as { sourceId: string }).sourceId);

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

interface TextStudio extends Studio {
  textStats(): { entries: number; meshes: number; materials: number; glow: boolean };
  textProbe(id: string): { visible: boolean; position: number[]; normal: number[]; camera: number[] } | null;
  getBoneWorldPositions(id: string): Record<string, [number, number, number]>;
}
type WT = Window & { __studio?: TextStudio; __clipTimeline?: CT & { addTextClip(spec?: Record<string, unknown>, at?: number, length?: number): string } };

test('3D text: Latin + Japanese, neon, bone-attached, billboard, no leaks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await boot(page);
  await openFiles(page, [PMX, DANCE]);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  await page.getByTestId('open-clips').click();
  await page.getByTestId('ct-add').click();
  await page.getByTestId('ct-add-text').click();
  await expect.poll(() => page.evaluate(() => (window as WT).__studio!.textStats().entries), { timeout: 30_000 }).toBe(1);
  const id = await page.evaluate(() => (window as WT).__clipTimeline!.get().selection[0]);
  await page.evaluate(() => (window as WT).__studio!.seek(30));
  await expect.poll(() => page.evaluate((i) => (window as WT).__studio!.textProbe(i)?.visible, id)).toBe(true);

  // Above the head, facing the camera.
  const probe = await page.evaluate((i) => {
    const s = (window as WT).__studio!;
    const model = s.listModels()[0];
    const text = s.textProbe(i)!;
    return { text, head: s.getBoneWorldPositions(model)['頭'], cam: text.camera };
  }, id);
  expect(probe.text.position[1]).toBeGreaterThan(probe.head[1] + 1);
  expect(Math.hypot(probe.text.position[0] - probe.head[0], probe.text.position[2] - probe.head[2])).toBeLessThan(0.5);
  const toCam = probe.cam.map((v: number, k: number) => v - probe.text.position[k]);
  const len = Math.hypot(...toCam);
  const facing = toCam.reduce((a: number, v: number, k: number) => a + (v / len) * probe.text.normal[k], 0);
  expect(facing).toBeGreaterThan(0.9);
  await page.screenshot({ path: 'e2e/__shots/text-default.png' });

  // Edit through the text panel: content, neon look, typewriter entrance.
  await page.locator(`[data-clip-id="${id}"]`).click();
  await page.getByTestId('ct-edit-text').click();
  await expect(page.getByTestId('text-panel')).toBeVisible();
  await page.getByTestId('text-content').fill('Hello / こんにちは!');
  await page.getByTestId('text-style-neon').click();
  await page.getByTestId('text-panel').getByLabel('In', { exact: true }).selectOption('typewriter');
  await expect
    .poll(() => page.evaluate((i) => (window as WT).__clipTimeline!.get().doc.clips.find((c) => c.id === i)!.text, id))
    .toMatchObject({ content: 'Hello / こんにちは!', style: 'neon', animIn: 'typewriter' });
  await expect.poll(() => page.evaluate(() => (window as WT).__studio!.textStats().glow)).toBe(true);
  await page.evaluate(() => (window as WT).__studio!.seek(60));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__shots/text-neon.png' });
  await page.getByTestId('text-done').click();
  await expect(page.getByTestId('text-panel')).toBeHidden();

  // Lyrics: one caption clip per SRT line on its own track.
  await page.getByTestId('ct-add').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('ct-add-subs').click();
  await (await chooser).setFiles([LYRICS]);
  await expect.poll(() => page.evaluate(() => (window as WT).__studio!.textStats().entries), { timeout: 30_000 }).toBe(4);
  const subs = await page.evaluate(() => {
    const d = (window as WT).__clipTimeline!.get().doc;
    const t = d.tracks.find((x) => x.kind === 'text' && x.name.startsWith('Subtitles'))!;
    return d.clips.filter((c) => c.trackId === t.id).map((c) => ({ start: c.startFrame, text: c.text!.content }));
  });
  expect(subs).toEqual([
    { start: 15, text: 'Hello world' },
    { start: 60, text: 'こんにちは世界' },
    { start: 105, text: 'La la la ♪' },
  ]);
  await page.evaluate(() => (window as WT).__studio!.seek(75));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__shots/text-captions.png' });
  await page.evaluate((i) => (window as WT).__clipTimeline!.set({ selection: [i] }), id);
  await page.getByTestId('clip-dock').hover();

  // Removing the clip disposes its mesh, material and the glow layer.
  await page.keyboard.press('Delete');
  await expect.poll(() => page.evaluate(() => (window as WT).__studio!.textStats())).toEqual({ entries: 3, meshes: 3, materials: 3, glow: false });
  await page.evaluate(() => {
    const ctl = (window as WT).__clipTimeline!;
    ctl.set({ doc: { ...ctl.get().doc, clips: [] } });
  });
  await expect.poll(() => page.evaluate(() => (window as WT).__studio!.textStats())).toEqual({ entries: 0, meshes: 0, materials: 0, glow: false });
  expect(errors).toEqual([]);
});
