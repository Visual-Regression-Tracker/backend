import os from "node:os";
import path from "node:path";
import type { LaunchOptions, PlaywrightTestOptions } from "@playwright/test";

/**
 * A render environment: the same page, drawn by a differently configured
 * browser. `reference` makes the baselines; the others stand for the machines
 * a real suite meets (a CI runner, another GPU path, other font settings) and
 * produce rendering noise only.
 */
export interface RenderEnvironment {
  description: string;
  launch?: LaunchOptions;
  context?: Partial<Pick<PlaywrightTestOptions, "deviceScaleFactor" | "hasTouch" | "isMobile">>;
}

const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), "Library", "Caches", "ms-playwright");
const swiftshader = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

export const environments: Record<string, RenderEnvironment> = {
  reference: {
    description: "Playwright 1.64 default: Chromium 156 headless shell, GPU raster",
  },
  chrome: {
    description: "a developer's Google Chrome instead of the bundled Chromium",
    launch: { channel: "chrome" },
  },
  swiftshader: {
    description: "a CI runner without a GPU: software GL through SwiftShader",
    launch: { args: swiftshader },
  },
  "chromium-143-swiftshader": {
    description: "an older Playwright (1.57, Chromium 143) on a CI runner without a GPU",
    launch: {
      executablePath: path.join(browsersPath, "chromium_headless_shell-1200", "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
      args: swiftshader,
    },
  },
  "chromium-133": {
    description: "a stale browser cache: Playwright 1.50's Chromium 133",
    launch: {
      executablePath: path.join(browsersPath, "chromium-1155", "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    },
  },
};

export const environment = (name: string): RenderEnvironment => {
  const env = environments[name];
  if (!env) {
    throw new Error(`Unknown render environment "${name}", use one of ${Object.keys(environments).join(", ")}`);
  }
  return env;
};
