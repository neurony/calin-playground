import { defineConfig } from "@playwright/test";

// Lets context.route() also intercept requests made by the extension's service worker.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

export default defineConfig({
  testDir: "./test",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
