import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  // Allow more time for replication polling
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    ignoreHTTPSErrors: true,
  },
});
