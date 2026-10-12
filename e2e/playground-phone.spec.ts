import { devices, expect, test } from '@playwright/test';

const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['Pixel 7'];
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

test('phone playground: edit a script and run the edited version', async ({ page }) => {
  await page.goto('/?engine=1');
  await page.waitForFunction(() => '__studio' in window, null, { timeout: 90_000, polling: 500 });
  await page.getByTestId('tab-bar').locator('[data-tab="more"]').click();
  await page.getByRole('button', { name: 'Playground' }).click();
  await page.getByRole('button', { name: 'Open example scripts' }).click();
  const code = page.getByTestId('script-code');
  await expect(code).toBeVisible();
  await code.fill('console.log("edited on a phone");');
  await page.getByTestId('run-script').click();
  await expect(page.getByTestId('console')).toContainText('edited on a phone');
  await page.getByRole('button', { name: 'Reset to the example' }).click();
  await expect(code).not.toHaveValue('console.log("edited on a phone");');
});
