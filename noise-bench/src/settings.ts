import fs from "node:fs";
import path from "node:path";
import demoConfig from "../demo.config.json";

export const ROOT = path.resolve(__dirname, "..");
export const RESULTS_DIR = path.join(ROOT, "results");
export const CACHE_DIR = path.join(ROOT, ".cache");
export const STORAGE_STATE = path.join(CACHE_DIR, "storage-state.json");
export const RUN_STATE = path.join(CACHE_DIR, "run.json");

const envFile = path.resolve(ROOT, process.env.DEMO_ENV_FILE ?? ".env.local");
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export type ProjectKey = keyof typeof demoConfig.projects;
export const PROJECT_KEYS = Object.keys(demoConfig.projects) as ProjectKey[];

export type Scenario = "baseline" | "calibration" | "noise" | "change" | "verify";
const SCENARIOS: Scenario[] = ["baseline", "calibration", "noise", "change", "verify"];

const list = (value: string | undefined) =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const scenario = (process.env.DEMO_SCENARIO ?? "baseline") as Scenario;
if (!SCENARIOS.includes(scenario)) {
  throw new Error(`DEMO_SCENARIO must be one of ${SCENARIOS.join(", ")}, got "${scenario}"`);
}

const envName = process.env.DEMO_ENV ?? "reference";
const bugs = process.env.DEMO_BUGS ?? "";
if (scenario === "change" && !bugs) {
  throw new Error("DEMO_SCENARIO=change needs DEMO_BUGS (a bug set such as set1, or bug ids)");
}

const projects = (list(process.env.DEMO_PROJECTS) ?? PROJECT_KEYS) as ProjectKey[];
for (const key of projects) {
  if (!PROJECT_KEYS.includes(key)) {
    throw new Error(`DEMO_PROJECTS: unknown project key "${key}", use ${PROJECT_KEYS.join(", ")}`);
  }
}

// set once in the main process, so every worker and the teardown join the same builds
process.env.DEMO_BUILD ||= [
  scenario,
  envName,
  scenario === "change" ? bugs.replace(/[^\w-]+/g, "+") : "",
  new Date().toISOString().replace(/[:.]/g, "-"),
]
  .filter(Boolean)
  .join("-");

export const settings = {
  uiUrl: process.env.VRT_UI_URL ?? demoConfig.uiUrl,
  apiUrl: process.env.VRT_API_URL ?? demoConfig.apiUrl,
  showcaseProject: process.env.DEMO_SHOWCASE_PROJECT ?? demoConfig.showcaseProject,
  projectNames: demoConfig.projects,
  bugSetCount: demoConfig.bugSetCount,
  frozenTime: new Date(demoConfig.frozenTime),
  scenario,
  envName,
  bugs,
  build: process.env.DEMO_BUILD,
  projects,
  tolerance: Number(process.env.DEMO_TOLERANCE ?? 0),
  dry: scenario === "verify" || process.env.DEMO_DRY === "1",
  screens: list(process.env.DEMO_SCREENS),
  themes: (list(process.env.DEMO_THEMES) ?? ["light", "dark"]) as Theme[],
};

export type Theme = "light" | "dark";

export const credentials = () => {
  const { VRT_DEMO_EMAIL, VRT_DEMO_PASSWORD, VRT_DEMO_API_KEY } = process.env;
  if (!VRT_DEMO_EMAIL || !VRT_DEMO_PASSWORD) {
    throw new Error("Set VRT_DEMO_EMAIL and VRT_DEMO_PASSWORD (in .env.local or the file DEMO_ENV_FILE names)");
  }
  return { email: VRT_DEMO_EMAIL, password: VRT_DEMO_PASSWORD, apiKey: VRT_DEMO_API_KEY ?? "" };
};
