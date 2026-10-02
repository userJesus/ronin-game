import { defineConfig, devices } from '@playwright/test';

// E2E_PROD=1 testa o build de produção (vite build + preview); senão, o servidor de desenvolvimento.
const prod = !!process.env.E2E_PROD;
const port = prod ? 4173 : 5190;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 720 },
    trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true },
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } }],
  webServer: {
    command: prod ? `npx vite build && npx vite preview --port ${port} --strictPort` : `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
