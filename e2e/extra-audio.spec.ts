import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PMX = join(fixtures, 'Mannequin/mannequin.pmx');
const DANCE = join(fixtures, 'Mannequin/mannequin-dance.vmd');
const BEAT = join(fixtures, 'beat.wav');

interface Studio {
  listModels(): string[];
  play(): void;
  pause(): void;
  seek(f: number): void;
  getExtraAudioStatus(): { layers: number; decoded: number; scheduled: number };
}
interface CT {
  get(): { doc: { tracks: { kind: string }[]; clips: { trackId: string }[] } };
}
type W = Window & { __studio?: Studio; __clipTimeline?: CT };

test('an extra sound on its own audio track plays together with the music', async ({ page }) => {
  await page.goto('/?engine=1');
  await page.waitForFunction(() => (window as W).__studio !== undefined, null, {
    timeout: 90_000,
    polling: 500,
  });
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open files / ZIP…' }).click();
  await (await chooser).setFiles([PMX, DANCE, BEAT]);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);

  await page.getByTestId('open-clips').click();
  await expect.poll(() => page.evaluate(() => !!(window as W).__clipTimeline)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as W).__clipTimeline!.get().doc.tracks.filter((t) => t.kind === 'audio').length,
      ),
    )
    .toBe(1);

  await page.getByTestId('ct-add').click();
  chooser = page.waitForEvent('filechooser');
  await page.getByTestId('ct-add-extra-audio').click();
  await (await chooser).setFiles([BEAT]);

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as W).__clipTimeline!.get().doc.tracks.filter((t) => t.kind === 'audio').length,
      ),
    )
    .toBe(2);
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.getExtraAudioStatus().decoded)).toBe(1);

  await page.evaluate(() => {
    const s = (window as W).__studio!;
    s.seek(0);
    s.play();
  });
  await expect
    .poll(() => page.evaluate(() => (window as W).__studio!.getExtraAudioStatus().scheduled))
    .toBe(1);
  await page.evaluate(() => (window as W).__studio!.pause());
  await expect
    .poll(() => page.evaluate(() => (window as W).__studio!.getExtraAudioStatus().scheduled))
    .toBe(0);
});
