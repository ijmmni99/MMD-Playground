import { defineConfig, devices } from '@playwright/test';

// WebGL in headless CI runs on SwiftShader (CPU), so timeouts are generous.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
// Containers that only ship Chromium can run the WebKit device profiles on Chromium instead.
const webkitAsChromium = process.env.PW_WEBKIT_AS_CHROMIUM === '1';

const chromiumArgs = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
];

type Device = (typeof devices)[string];

function landscape(d: Device): Device {
  return { ...d, viewport: { width: d.viewport.height, height: d.viewport.width } };
}

function mobileProject(name: string, device: Device) {
  const webkit = device.defaultBrowserType === 'webkit' && !webkitAsChromium;
  return {
    name,
    testMatch: /mobile\.spec\.ts/,
    use: {
      ...device,
      browserName: webkit ? ('webkit' as const) : ('chromium' as const),
      launchOptions: webkit ? {} : { executablePath, args: chromiumArgs },
    },
  };
}

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    // The service worker would cache builds across runs; tests always want the fresh build.
    serviceWorkers: 'block',
    // Drawers/sheets animate in; without motion they settle at once, so hit-testing is stable.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    {
      name: 'desktop-chromium',
      testMatch: /(smoke|video2vmd|motion-editor|names|clips|converter|modeleditor)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: { executablePath, args: chromiumArgs },
      },
    },
    mobileProject('pixel-7', devices['Pixel 7']),
    mobileProject('pixel-7-landscape', devices['Pixel 7 landscape']),
    mobileProject('iphone-14', devices['iPhone 14']),
    mobileProject('iphone-14-landscape', devices['iPhone 14 landscape']),
    mobileProject('ipad', devices['iPad (gen 7)']),
    mobileProject('ipad-landscape', landscape(devices['iPad (gen 7)'])),
  ],
  webServer: {
    command: 'pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
