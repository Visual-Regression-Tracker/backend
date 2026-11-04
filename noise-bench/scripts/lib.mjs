import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const RESULTS_DIR = path.join(ROOT, "results");
export const STATE_FILE = path.join(RESULTS_DIR, "demo-state.json");

const envFile = path.resolve(ROOT, process.env.DEMO_ENV_FILE ?? ".env.local");
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export const config = JSON.parse(fs.readFileSync(path.join(ROOT, "demo.config.json"), "utf8"));
export const apiUrl = process.env.VRT_API_URL ?? config.apiUrl;
export const uiUrl = process.env.VRT_UI_URL ?? config.uiUrl;
export const PROJECT_KEYS = Object.keys(config.projects);
export const noiseEnvironments = process.env.DEMO_NOISE_ENVS
  ? process.env.DEMO_NOISE_ENVS.split(",").map((name) => name.trim())
  : config.noiseEnvironments;
export const bugSetNames = Array.from({ length: config.bugSetCount }, (_, i) => `set${i + 1}`);

export const buildLink = (projectId, buildId, testRunId) =>
  `${uiUrl}/${projectId}?buildId=${buildId}${testRunId ? `&testId=${testRunId}` : ""}`;

/** The REST calls of the demo scripts, as the demo user (the read and approve endpoints take a JWT). */
export async function login() {
  const { VRT_DEMO_EMAIL: email, VRT_DEMO_PASSWORD: password } = process.env;
  if (!email || !password) {
    throw new Error("Set VRT_DEMO_EMAIL and VRT_DEMO_PASSWORD (in .env.local or the file DEMO_ENV_FILE names)");
  }
  const response = await fetch(`${apiUrl}/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`Login to ${apiUrl} failed with ${response.status}`);
  }
  const { token } = await response.json();
  const call = async (method, route, body) => {
    const res = await fetch(`${apiUrl}${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`${method} ${route} returned ${res.status}: ${await res.text()}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  };
  return {
    projects: () => call("GET", "/projects"),
    testRuns: (buildId) => call("GET", `/test-runs?buildId=${buildId}`),
    approveBuild: (buildId) => call("PATCH", `/builds/${buildId}/approve?merge=false`),
    updateIgnoreAreas: (ids, ignoreAreas) => call("POST", "/test-runs/ignoreAreas/update", { ids, ignoreAreas }),
  };
}

export const manifestPath = (build) => path.join(RESULTS_DIR, `manifest-${build}.json`);

export function readManifest(build) {
  const file = manifestPath(build);
  if (!fs.existsSync(file)) {
    throw new Error(`No manifest for build ${build}: did the run reach global teardown?`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function readManifests() {
  if (!fs.existsSync(RESULTS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(RESULTS_DIR)
    .filter((file) => /^manifest-.*\.json$/.test(file))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), "utf8")));
}

export function readState() {
  return fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
}

export function writeState(update) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const state = { ...readState(), ...update };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  return state;
}

/** Runs the Playwright suite once; returns whether every test passed. */
export function runSuite(env) {
  console.log(`\n▶ ${Object.entries(env).map(([key, value]) => `${key}=${value}`).join(" ")}`);
  const result = spawnSync("npx", ["playwright", "test"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return result.status === 0;
}
