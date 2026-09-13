import { defineConfig } from "@playwright/test";
import { webPort, webUrl } from "./e2e/web-url";

const fixturePort = process.env.SHELF_JUDGE_E2E_FIXTURE_PORT ?? "3111";
const socketPath = process.env.SHELF_JUDGE_E2E_SOCKET ?? "/tmp/shelf-judge-playwright.sock";
const nextDistDir = process.env.SHELF_JUDGE_E2E_NEXT_DIST_DIR ?? ".next-e2e";
const fixtureUrl = `http://127.0.0.1:${fixturePort}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webUrl,
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
      url: `${fixtureUrl}/health`,
      env: {
        SHELF_JUDGE_E2E_FIXTURE_PORT: fixturePort,
        SHELF_JUDGE_SOCKET: socketPath,
      },
      reuseExistingServer: false,
    },
    {
      command: `bun run dev --hostname 127.0.0.1 --port ${webPort}`,
      url: webUrl,
      env: { SHELF_JUDGE_SOCKET: socketPath, SHELF_JUDGE_NEXT_DIST_DIR: nextDistDir },
      reuseExistingServer: false,
    },
  ],
});
