import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30000,
  workers: 1,
  use: {
    trace: "on-first-retry"
  },
  forbidOnly: false,
  retries: 0,
  reporter: "list"
});
