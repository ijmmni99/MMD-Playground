import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MODEL = [
  join(fixtures, 'LookTest/looktest.pmx'),
  join(fixtures, 'LookTest/tex/face.png'),
  join(fixtures, 'LookTest/tex/top.png'),
];

interface Studio {
  listModels(): string[];
  seek(f: number): void;
  pause(): void;
  getSunState(): { color: number[]; direction: number[] };
}
type W = Window & { __studio?: Studio };

/** A VMD with a light track (red at frame 0, blue at frame 60) and one bone key at frame 90 so the motion has a length. */
function lightVmd(): Buffer {
  const buf = Buffer.alloc(50 + 4 + 111 + 4 + 4 + 4 + 2 * 28 + 4);
  buf.write('Vocaloid Motion Data 0002', 0, 'ascii');
  buf.writeUInt32LE(1, 50);
  buf.write('center', 54, 'ascii');
  buf.writeUInt32LE(90, 54 + 15);
  buf.writeFloatLE(1, 54 + 15 + 4 + 12 + 12 + 12); // rotation w
  let o = 50 + 4 + 111 + 8; // morph and camera counts stay 0
  buf.writeUInt32LE(2, o);
  o += 4;
  for (const [frame, color] of [
    [0, [1, 0, 0]],
    [60, [0, 0, 1]],
  ] as const) {
    buf.writeUInt32LE(frame, o);
    color.forEach((c, i) => buf.writeFloatLE(c, o + 4 + i * 4));
    [0, -1, 0].forEach((c, i) => buf.writeFloatLE(c, o + 16 + i * 4));
    o += 28;
  }
  return buf;
}

test('VMD light track drives the sun, and the toggle hands control back', async ({ page }) => {
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles(MODEL);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);

  const manual = await page.evaluate(() => (window as W).__studio!.getSunState());

  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add model or files' }).click();
  await (
    await chooser
  ).setFiles([{ name: 'light.vmd', mimeType: 'application/octet-stream', buffer: lightVmd() }]);

  const sunAt = async (frame: number) => {
    await page.evaluate((f) => {
      const s = (window as W).__studio!;
      s.pause();
      s.seek(f);
    }, frame);
    await page.waitForTimeout(300);
    return page.evaluate(() => (window as W).__studio!.getSunState());
  };

  await expect.poll(async () => (await sunAt(0)).color[0]).toBeGreaterThan(0.9);
  const start = await sunAt(0);
  expect(start.color[2]).toBeLessThan(0.1);
  const mid = await sunAt(30);
  expect(mid.color[0]).toBeCloseTo(0.5, 1);
  expect(mid.color[2]).toBeCloseTo(0.5, 1);
  const end = await sunAt(60);
  expect(end.color[2]).toBeGreaterThan(0.9);

  // Switch it off: the manual sun comes back.
  await page.getByRole('tab', { name: 'Scene' }).click();
  await page.getByRole('switch', { name: 'Use motion light (VMD)' }).click();
  await page.waitForTimeout(300);
  const off = await page.evaluate(() => (window as W).__studio!.getSunState());
  expect(off.color[0]).toBeCloseTo(manual.color[0], 2);
  expect(off.color[2]).toBeCloseTo(manual.color[2], 2);
});
