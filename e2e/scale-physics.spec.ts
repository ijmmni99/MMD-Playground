import { expect, test } from '@playwright/test';

interface Studio {
  listModels(): string[];
  getPhysicsScale(id: string): number;
  getModelState(id: string): { transform: { position: number[]; rotation: number[]; scale: number } } | null;
  setModelTransform(id: string, t: { position: number[]; rotation: number[]; scale: number }): void;
}
type W = Window & { __studio?: Studio };

test('scaling a model with physics rebuilds its rigid bodies at the new scale and keeps its state', async ({
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
  await page.getByTestId('load-sample').click();
  await expect.poll(() => page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  const id = await page.evaluate(() => (window as W).__studio!.listModels()[0]);
  expect(await page.evaluate((i) => (window as W).__studio!.getPhysicsScale(i), id)).toBe(1);

  await page.evaluate((i) => {
    (window as W).__studio!.setModelTransform(i, { position: [3, 0, 0], rotation: [0, 20, 0], scale: 2 });
  }, id);
  await expect.poll(() => page.evaluate((i) => (window as W).__studio!.getPhysicsScale(i), id)).toBe(2);

  const state = await page.evaluate((i) => (window as W).__studio!.getModelState(i)!.transform, id);
  expect(state.scale).toBe(2);
  expect(state.position[0]).toBe(3);
  expect(state.rotation[1]).toBeCloseTo(20, 3);
  expect(await page.evaluate(() => (window as W).__studio!.listModels().length)).toBe(1);
  expect(errors).toEqual([]);
});
