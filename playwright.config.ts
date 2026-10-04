import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './playwright/tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'Desktop_Chrome', use: { ...devices['Desktop Chrome'] } },
  ],
});
