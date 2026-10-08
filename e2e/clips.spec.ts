import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';

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
  text?: { content: string; position: number[] };
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
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  await page.getByLabel('Render quality').selectOption('low');
}

async function openFiles(page: Page, files: string[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: /Open files \/ ZIP…|Upload ZIP or files…|^Add model/ })
    .first()
    .click();
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
  await expect
    .poll(() => page.evaluate(() => (window as W).__studio!.getPlayback().duration))
    .toBeGreaterThanOrEqual(len0 + dance[1].sourceOut - dance[1].sourceIn - 1);

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
  await expect
    .poll(() => page.evaluate(() => (window as W).__clipTimeline!.get().selection))
    .toEqual([dance[0].id]);
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
    ({ x, y }) =>
      (document.elementFromPoint(x, y)?.closest('[data-clip-id]') as HTMLElement | null)?.dataset.clipId,
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
  await expect
    .poll(async () => (await kindClips(page, 'dance')).find((c) => c.id === last.id)!.speed)
    .toBe(2);
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
  await expect
    .poll(() => page.evaluate(() => (window as W).__studio!.getPlayback().frame), { timeout: 20_000 })
    .toBeGreaterThan(cut + 5);
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
    .poll(
      async () =>
        ((await doc(page)).clips.find((x) => x.id === first.id) as unknown as { sourceId: string }).sourceId,
    )
    .toBe((first as unknown as { sourceId: string }).sourceId);

  // Export the baked timeline as VMD (dance + camera).
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.getByTestId('ct-export-vmd').click();
  await expect.poll(() => downloads.sort()).toEqual(['camera-timeline.vmd', 'mannequin-timeline.vmd']);

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
  textProbe(
    id: string,
  ): { visible: boolean; position: number[]; normal: number[]; camera: number[]; screen: number[] } | null;
  getBoneWorldPositions(id: string): Record<string, [number, number, number]>;
}
type WT = Window & {
  __studio?: TextStudio;
  __clipTimeline?: CT & { addTextClip(spec?: Record<string, unknown>, at?: number, length?: number): string };
};

test('3D text: Latin + Japanese, neon, bone-attached, billboard, no leaks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await boot(page);
  await openFiles(page, [PMX, DANCE]);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  await page.getByTestId('open-clips').click();
  // The dance loaded outside the timeline shows up as a clip (and keeps playing).
  await expect.poll(() => page.evaluate(() => !!(window as WT).__clipTimeline)).toBe(true);
  await expect.poll(async () => (await kindClips(page, 'dance')).length).toBe(1);
  // A motion loaded from the Models panel joins the timeline instead of being overridden by it.
  await openFiles(page, [DANCE2]);
  await expect.poll(async () => (await kindClips(page, 'dance')).length).toBe(2);
  await page.getByTestId('ct-add').click();
  await page.getByTestId('ct-add-text').click();
  await expect
    .poll(() => page.evaluate(() => (window as WT).__studio!.textStats().entries), { timeout: 30_000 })
    .toBe(1);
  const id = await page.evaluate(() => (window as WT).__clipTimeline!.get().selection[0]);
  await page.evaluate(() => (window as WT).__studio!.seek(30));
  await expect
    .poll(() => page.evaluate((i) => (window as WT).__studio!.textProbe(i)?.visible, id))
    .toBe(true);

  // Above the head, facing the camera.
  const probe = await page.evaluate((i) => {
    const s = (window as WT).__studio!;
    const model = s.listModels()[0];
    const text = s.textProbe(i)!;
    return { text, head: s.getBoneWorldPositions(model)['頭'], cam: text.camera };
  }, id);
  expect(probe.text.position[1]).toBeGreaterThan(probe.head[1] + 1);
  expect(
    Math.hypot(probe.text.position[0] - probe.head[0], probe.text.position[2] - probe.head[2]),
  ).toBeLessThan(0.5);
  const toCam = probe.cam.map((v: number, k: number) => v - probe.text.position[k]);
  const len = Math.hypot(...toCam);
  const facing = toCam.reduce((a: number, v: number, k: number) => a + (v / len) * probe.text.normal[k], 0);
  expect(facing).toBeGreaterThan(0.9);
  await page.screenshot({ path: 'e2e/__shots/text-default.png' });

  // Drag the text down in the viewport: its offset above the head shrinks, and the camera doesn't orbit.
  const yBefore = await page.evaluate(
    (i) => (window as WT).__clipTimeline!.get().doc.clips.find((c) => c.id === i)!.text!,
    id,
  );
  const sp = (await page.evaluate((i) => (window as WT).__studio!.textProbe(i)!.screen, id)) as [
    number,
    number,
  ];
  const camBefore = probe.cam;
  await page.mouse.move(sp[0], sp[1]);
  await page.mouse.down();
  await page.mouse.move(sp[0], sp[1] + 30, { steps: 4 });
  await page.mouse.move(sp[0], sp[1] + 60, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        (i) => (window as WT).__clipTimeline!.get().doc.clips.find((c) => c.id === i)!.text!.position[1],
        id,
      ),
    )
    .toBeLessThan(yBefore.position[1] - 0.5);
  const camAfter = await page.evaluate((i) => (window as WT).__studio!.textProbe(i)!.camera, id);
  expect(camAfter.map((v, k) => Math.abs(v - camBefore[k])).every((d) => d < 1e-3)).toBe(true);

  // Edit through the text panel: content, neon look, typewriter entrance.
  await page.locator(`[data-clip-id="${id}"]`).click();
  await page.getByTestId('ct-edit-text').click();
  await expect(page.getByTestId('text-panel')).toBeVisible();
  await page.getByTestId('text-content').fill('Hello / こんにちは!');
  await page.getByTestId('text-style-neon').click();
  await page.getByTestId('text-panel').getByLabel('In', { exact: true }).selectOption('typewriter');
  await expect
    .poll(() =>
      page.evaluate((i) => (window as WT).__clipTimeline!.get().doc.clips.find((c) => c.id === i)!.text, id),
    )
    .toMatchObject({ content: 'Hello / こんにちは!', style: 'neon', animIn: 'typewriter' });
  await expect.poll(() => page.evaluate(() => (window as WT).__studio!.textStats().glow)).toBe(true);
  await page.evaluate(() => (window as WT).__studio!.seek(60));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__shots/text-neon.png' });
  await page.getByTestId('text-done').click();
  await expect(page.getByTestId('text-panel')).toBeHidden();

  // Screenshots and videos render the text (neon cyan pixels in the image).
  const cyan = await page.evaluate(async () => {
    const s = (window as WT).__studio! as unknown as { screenshot(o: object): Promise<Blob> };
    const blob = await s.screenshot({ width: 640, height: 360, transparent: false });
    const img = await createImageBitmap(blob);
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 140 && d[i + 1] > 170 && d[i + 2] > 190) n++;
    return n;
  });
  expect(cyan).toBeGreaterThan(40);
  const video = await page.evaluate(async () => {
    const s = (window as WT).__studio! as unknown as {
      record(o: object, p: (x: unknown) => void, sig: AbortSignal): Promise<Blob>;
    };
    const blob = await s.record(
      {
        width: 320,
        height: 180,
        fps: 30,
        mimeType: 'video/webm',
        deterministic: true,
        startFrame: 50,
        endFrame: 56,
        includeAudio: false,
        bitrate: 500_000,
      },
      () => {},
      new AbortController().signal,
    );
    return blob.size;
  });
  expect(video).toBeGreaterThan(1000);

  // Lyrics: one caption clip per SRT line on its own track.
  await page.getByTestId('ct-add').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('ct-add-subs').click();
  await (await chooser).setFiles([LYRICS]);
  await expect
    .poll(() => page.evaluate(() => (window as WT).__studio!.textStats().entries), { timeout: 30_000 })
    .toBe(4);
  const subs = await page.evaluate(() => {
    const d = (window as WT).__clipTimeline!.get().doc;
    const t = d.tracks.find((x) => x.kind === 'text' && x.name.startsWith('Subtitles'))!;
    return d.clips
      .filter((c) => c.trackId === t.id)
      .map((c) => ({ start: c.startFrame, text: c.text!.content }));
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
  await expect
    .poll(() => page.evaluate(() => (window as WT).__studio!.textStats()))
    .toEqual({ entries: 3, meshes: 3, materials: 3, glow: false });
  await page.evaluate(() => {
    const ctl = (window as WT).__clipTimeline!;
    ctl.set({ doc: { ...ctl.get().doc, clips: [] } });
  });
  await expect
    .poll(() => page.evaluate(() => (window as WT).__studio!.textStats()))
    .toEqual({ entries: 0, meshes: 0, materials: 0, glow: false });
  expect(errors).toEqual([]);
});

for (const [name, device] of [
  ['phone', devices['Pixel 7']],
  ['tablet', devices['iPad (gen 7)']],
] as const) {
  test.describe(name, () => {
    const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = device;
    test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

    test(`clip timeline is the default view and usable on ${name}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/?engine=1');
      await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
        timeout: 90_000,
        polling: 500,
      });
      await openFiles(page, [PMX]);
      await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
      if (name === 'phone') await page.getByTestId('tab-bar').locator('[data-tab="timeline"]').click();
      await expect(page.getByTestId('clip-dock')).toBeVisible();
      await expect(page.getByTestId('open-clips')).toHaveAttribute('aria-pressed', 'true');
      // 44px touch targets in the toolbar.
      for (const id of ['ct-undo', 'ct-add'])
        expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);

      await addViaMenu(page, 'ct-add-motion', [DANCE, DANCE]);
      await expect.poll(async () => (await kindClips(page, 'dance')).length).toBe(2);
      const [a] = await kindClips(page, 'dance');
      // Tap selects; the contextual tools appear.
      const box = (await page.locator(`[data-clip-id="${a.id}"]`).boundingBox())!;
      await page.touchscreen.tap(box.x + Math.min(20, box.width / 2), box.y + box.height / 2);
      await expect(page.getByTestId('ct-split')).toBeVisible();
      await page.getByTestId('ct-duplicate').click();
      await expect.poll(async () => (await kindClips(page, 'dance')).length).toBe(3);

      // Text editing in a bottom sheet (phone) / panel (tablet).
      await page.getByTestId('ct-add').click();
      await page.getByTestId('ct-add-text').click();
      await page.getByTestId('ct-edit-text').click();
      await expect(page.getByTestId('text-panel')).toBeVisible();
      const panel = (await page.getByTestId('text-panel').boundingBox())!;
      expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width + 1);
      await page.getByTestId('text-content').fill('Hi こんにちは');
      await expect
        .poll(() => page.evaluate(() => (window as WT).__studio!.textStats().entries), { timeout: 30_000 })
        .toBe(1);
      await page.screenshot({ path: `e2e/__shots/clips-${name}-text.png` });
      await page.getByTestId('text-done').click();
      // No horizontal overflow.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
        true,
      );
      await page.screenshot({ path: `e2e/__shots/clips-${name}.png` });
      expect(errors).toEqual([]);
    });
  });
}
