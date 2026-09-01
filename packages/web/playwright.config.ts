import { defineConfig } from "@playwright/test";

const socketPath = "/tmp/shelf-judge-playwright.sock";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    colorScheme: "light",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium-mobile", use: { viewport: { width: 375, height: 812 } } },
    { name: "chromium-tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "chromium-desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "chromium-desktop-200-percent-layout-equivalent",
      use: {
        viewport: { width: 720, height: 450 },
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: [
    {
      command: "bun e2e/fixture-daemon.ts",
      url: "http://127.0.0.1:3101/health",
      env: { SHELF_JUDGE_SOCKET: socketPath },
      reuseExistingServer: false,
    },
    {
      command: "bun run dev --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100",
      env: { SHELF_JUDGE_SOCKET: socketPath },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
