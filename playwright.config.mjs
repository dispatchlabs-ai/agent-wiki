import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  retries: 0,
  use: { browserName: "chromium", headless: true },
});
