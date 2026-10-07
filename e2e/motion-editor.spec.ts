import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PMX = join(fixtures, 'Mannequin/mannequin.pmx');
const DANCE = join(fixtures, 'Mannequin/mannequin-dance.vmd');
const CAMERA = join(fixtures, 'Mannequin/mannequin-camera.vmd');

interface Studio {
  listModels(): string[];
  getPlayback(): { frame: number; playing: boolean; duration: number };
  seek(f: number): void;
  pause(): void;
}
type W = Window & { __studio?: Studio };

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
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles(files);
}

interface Clip {
  bones: { name: string; keys: { f: number }[] }[];
  camera: { f: number }[];
}
interface MotionEditorProbe {
  state(): {
    modelId: string | null;
    clips: Record<string, Clip>;
    camera: Clip | null;
    selection: Set<string>;
  };
  keyPoint(track: string, f: number): { x: number; y: number } | null;
  history(): { past: number; future: number };
}
type ME = Window & { __motionEditor?: MotionEditorProbe };

const boneFrames = (page: Page, bone: string): Promise<number[]> =>
  page.evaluate((b) => {
    const s = (window as ME).__motionEditor!.state();
    return s.clips[s.modelId!].bones.find((t) => t.name === b)?.keys.map((k) => k.f) ?? [];
  }, bone);

async function keyPoint(page: Page, track: string, f: number): Promise<{ x: number; y: number }> {
  const get = () =>
    page.evaluate(
      ([t, fr]) => (window as ME).__motionEditor!.keyPoint(t as string, fr as number),
      [track, f],
    );
  await expect.poll(get).not.toBeNull();
  return (await get())!;
}

test('motion editor: dope sheet, key edits, undo/redo, camera, export, persist', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await boot(page);
  await openFiles(page, [PMX, DANCE]);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  await page.getByTestId('open-editor').click();
  await expect(page.getByTestId('dope-sheet')).toBeVisible();
  await expect.poll(() => boneFrames(page, '頭')).not.toEqual([]);
  const head = await boneFrames(page, '頭');
  const f0 = head[1];

  // Select a key and drag it 4 frames right (snapping off so it lands exactly).
  await page.getByTestId('me-snap').click();
  const p = await keyPoint(page, '頭', f0);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('me-selected')).toContainText('1 selected');
  const p2 = await keyPoint(page, '頭', f0 + 4);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + p2.x) / 2, p.y, { steps: 3 });
  await page.mouse.move(p2.x, p.y, { steps: 3 });
  await page.mouse.up();
  await expect.poll(() => boneFrames(page, '頭')).toContain(f0 + 4);
  expect(await boneFrames(page, '頭')).not.toContain(f0);
  expect(await page.evaluate(() => (window as ME).__motionEditor!.history().past)).toBe(1);

  // Undo / redo.
  await page.keyboard.press('Control+z');
  await expect.poll(() => boneFrames(page, '頭')).toContain(f0);
  await page.getByTestId('me-redo').click();
  await expect.poll(() => boneFrames(page, '頭')).toContain(f0 + 4);

  // Key the pose at a new frame (K).
  await page.evaluate(() => (window as W).__studio!.seek(7));
  await page.getByTestId('dope-sheet').hover();
  await page.keyboard.press('k');
  await expect.poll(() => boneFrames(page, '上半身')).toContain(7);

  // Graph editor: preset, bezier handle drag, numeric value edit on the selected key.
  const k = await keyPoint(page, '頭', f0 + 4);
  await page.mouse.click(k.x, k.y);
  await page.getByTestId('me-graph').click();
  await expect(page.getByTestId('graph-editor')).toBeVisible();
  const curve = () =>
    page.evaluate((f) => {
      const s = (window as ME).__motionEditor!.state();
      const key = (
        s.clips[s.modelId!] as unknown as {
          bones: { name: string; keys: { f: number; ip: number[]; r: number[] }[] }[];
        }
      ).bones
        .find((t) => t.name === '頭')!
        .keys.find((x) => x.f === f)!;
      return { ip: key.ip.slice(12, 16), r: key.r };
    }, f0 + 4);
  await page.getByTestId('preset-ease-in').click();
  await expect.poll(async () => (await curve()).ip).toEqual([64, 0, 107, 107]);
  const h = await page.getByTestId('curve-handle-2').boundingBox();
  await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
  await page.mouse.down();
  await page.mouse.move(h!.x - 20, h!.y + 25, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await curve()).ip[2]).toBeLessThan(107);
  const before = (await curve()).r;
  await page.getByLabel('Rot Y°').fill('25');
  await page.getByLabel('Rot Y°').press('Enter');
  await expect.poll(async () => (await curve()).r).not.toEqual(before);
  await page.screenshot({ path: 'e2e/__shots/me-desktop.png' });
  await page.getByTestId('me-graph').click();

  // Motion tools: smooth a range, mirror, then undo both.
  await page.getByTestId('me-tools').click();
  await expect(page.getByTestId('me-tools-panel')).toBeVisible();
  const range = page.getByTestId('me-range');
  await range.getByLabel('From').fill('0');
  await range.getByLabel('To').fill('60');
  const armR = () =>
    page.evaluate(() => {
      const s = (window as ME).__motionEditor!.state();
      const c = s.clips[s.modelId!] as unknown as { bones: { name: string; keys: { f: number; r: number[] }[] }[] };
      return {
        left: c.bones.find((t) => t.name === '左腕')!.keys[1].r,
        right: c.bones.find((t) => t.name === '右腕')!.keys[1].r,
      };
    });
  const headCount = (await boneFrames(page, '頭')).length;
  await page.getByTestId('tool-smooth').click();
  await expect.poll(async () => (await boneFrames(page, '頭')).length).toBeGreaterThan(headCount);
  const arms = await armR();
  await page.getByTestId('tool-mirror').click();
  await expect.poll(async () => (await armR()).left[1]).toBeCloseTo(-arms.right[1], 5);
  await page.screenshot({ path: 'e2e/__shots/me-tools.png' });
  await page.getByTestId('me-undo').click();
  await page.getByTestId('me-undo').click();
  await expect.poll(async () => (await boneFrames(page, '頭')).length).toBe(headCount);
  await page.getByTestId('me-tools').click();

  // Camera motion appears as its own track.
  const camChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load' }).first().click();
  await (await camChooser).setFiles(CAMERA);
  await expect
    .poll(() => page.evaluate(() => (window as ME).__motionEditor!.state().camera?.camera.length ?? 0))
    .toBe(3);

  // Export the edited motion.
  await page.getByTestId('me-export-open').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('me-export-motion').click();
  const bytes = readFileSync(await (await download).path());
  expect(bytes.subarray(0, 25).toString('ascii')).toBe('Vocaloid Motion Data 0002');
  expect(bytes.readUInt32LE(50)).toBeGreaterThan(100);

  // Reload: edits are restored from the autosaved project.
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 30_000 });
  await page.reload();
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  await page.getByTestId('open-editor').click();
  await expect(page.getByTestId('dope-sheet')).toBeVisible();
  await expect.poll(() => boneFrames(page, '頭')).toContain(f0 + 4);
  expect(await boneFrames(page, '上半身')).toContain(7);
  expect(errors).toEqual([]);
});

interface StudioIk extends Studio {
  getBoneWorldPositions(id: string): Record<string, [number, number, number]>;
  getSkeleton(id: string): { bones: { name: string }[] };
  selectBone(id: string | null, bone: number | null): void;
  getBoneTransform(id: string, bone: number): { rotation: number[]; position: number[] };
  setBoneTransform(id: string, bone: number, t: { rotation: number[]; position: number[] }): void;
}
type WI = Window & { __studio?: StudioIk; __motionEditor?: MotionEditorProbe };

test('motion editor: IK drag + key, bake IK→FK, fit IK, foot pins', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await boot(page);
  await openFiles(page, [PMX, DANCE]);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  await page.getByTestId('open-editor').click();
  await expect(page.getByTestId('dope-sheet')).toBeVisible();
  await expect.poll(() => boneFrames(page, '左足ＩＫ')).not.toEqual([]);
  await page.getByTestId('me-ik').click();
  await expect(page.getByTestId('me-ik-panel')).toBeVisible();
  await page.getByLabel('Show IK chains, targets, knee direction').check();

  // Drag the left foot IK target (as the move gizmo would) at a new frame and key it: the IK bone and,
  // with "key FK chain" on, the solved knee/thigh get keys.
  await page.evaluate(() => (window as WI).__studio!.seek(33));
  await page.evaluate(() => {
    const st = (window as WI).__studio!;
    const id = st.listModels()[0];
    const i = st.getSkeleton(id).bones.findIndex((b) => b.name === '左足ＩＫ');
    st.selectBone(id, i);
    const t = st.getBoneTransform(id, i);
    st.setBoneTransform(id, i, { rotation: t.rotation, position: [t.position[0], t.position[1] + 1.5, t.position[2] - 1] });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/__shots/me-ik.png' });
  await page.getByTestId('me-key').click();
  await expect.poll(() => boneFrames(page, '左足ＩＫ')).toContain(33);
  expect(await boneFrames(page, '左ひざ')).toContain(33);
  await page.evaluate(() => (window as WI).__studio!.selectBone(null, null));

  // Bake IK → FK over 0–40: pose unchanged (tiny error), knee keyed densely, IK off in range.
  const range = page.getByTestId('me-range');
  await range.getByLabel('From').fill('0');
  await range.getByLabel('To').fill('40');
  await page.getByLabel('Reduce keys').uncheck();
  await page.getByTestId('ik-bake').click();
  await expect(page.getByTestId('ik-result')).toContainText('Bake IK → FK: 41 frames');
  const err = async () => parseFloat((await page.getByTestId('ik-result').textContent())!.split('error ')[1]);
  expect(await err()).toBeLessThan(0.02);
  expect((await boneFrames(page, '左ひざ')).filter((f) => f <= 40).length).toBe(41);

  // Fit IK from FK on the same range: the IK targets land where FK put the feet.
  await page.getByTestId('ik-fit').click();
  await expect(page.getByTestId('ik-result')).toContainText('Fit IK from FK');
  expect(await err()).toBeLessThan(0.02);

  const ankle = (f: number) =>
    page.evaluate(async (frame) => {
      const st = (window as WI).__studio!;
      st.seek(frame);
      await new Promise((r) => setTimeout(r, 200));
      return st.getBoneWorldPositions(st.listModels()[0])['左足首'];
    }, f);
  await page.waitForTimeout(300);
  const free = [await ankle(55), await ankle(85)];
  expect(Math.hypot(...free[0].map((v, i) => v - free[1][i]))).toBeGreaterThan(0.1);
  // Pin the left foot over 50–90: the ankle stays put in world space.
  await range.getByLabel('From').fill('50');
  await range.getByLabel('To').fill('90');
  await page.getByTestId('ik-pin').click();
  await expect(page.getByTestId('ik-pins').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('ik-pins')).toContainText('50–90');
  await page.waitForTimeout(300);
  const a = await ankle(55);
  const b = await ankle(85);
  expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.01);
  await page.screenshot({ path: 'e2e/__shots/me-ik-panel.png' });
  expect(errors).toEqual([]);
});
