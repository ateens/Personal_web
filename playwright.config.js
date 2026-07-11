import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 43128);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error(`E2E_PORT must be an unprivileged TCP port, received ${process.env.E2E_PORT || ""}.`);
}

const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./output/playwright-test",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["line"]],
  use: {
    baseURL,
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tests/fixture-server.mjs",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 15_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      E2E_FIXTURE_SERVER: "1",
      E2E_PORT: String(port),
    },
  },
});
