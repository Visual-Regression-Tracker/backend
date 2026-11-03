import { defineConfig } from "@playwright/test";
import { environment } from "./src/environments";
import { settings, STORAGE_STATE } from "./src/settings";

const env = environment(settings.envName);

export default defineConfig({
  testDir: "./src",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  fullyParallel: true,
  // more workers make more screens differ by a few ±1 pixels between two renders
  workers: Number(process.env.DEMO_WORKERS ?? 2),
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  outputDir: "./results/test-results",
  use: {
    baseURL: settings.uiUrl,
    storageState: STORAGE_STATE,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    // number inputs format with the browser's own locale, not the context's
    launchOptions: { ...env.launch, args: ["--lang=en-US", ...(env.launch?.args ?? [])] },
    ...env.context,
  },
});
