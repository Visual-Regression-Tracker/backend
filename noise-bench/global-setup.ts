import fs from "node:fs";
import { chromium } from "@playwright/test";
import { readParts, partsDir, writeRunState, type TargetProject } from "./src/run-state";
import { CACHE_DIR, credentials, settings, STORAGE_STATE } from "./src/settings";
import { resolveShowcase } from "./src/showcase";
import { MultiProjectTracker } from "./src/tracker";
import { VrtApi } from "./src/vrt-api";

/** Signs in through the UI once and saves the session for every test. */
async function signIn() {
  const { email, password } = credentials();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: settings.uiUrl });
    await page.goto("/login");
    await page.getByTestId("email").fill(email);
    await page.getByTestId("password").fill(password);
    await page.getByTestId("loginBtn").click();
    await page.waitForURL("**/projects");
    await page.context().storageState({ path: STORAGE_STATE });
  } finally {
    await browser.close();
  }
}

async function targetProjects(api: VrtApi): Promise<TargetProject[]> {
  const all = await api.projects();
  const targets = settings.projects.map((key) => {
    const name = settings.projectNames[key];
    const project = all.find((candidate) => candidate.name === name);
    return { key, name, id: project?.id ?? "", branch: project?.mainBranchName ?? "" };
  });
  const missing = targets.filter((target) => !target.id).map((target) => `"${target.name}"`);
  if (missing.length) {
    throw new Error(`VRT projects not found: ${missing.join(", ")}. Create them first (scripts/setup-projects.mjs).`);
  }
  return targets;
}

export default async function globalSetup() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (readParts().length) {
    throw new Error(`${partsDir()} already holds results: pick a new DEMO_BUILD`);
  }
  const { email, password } = credentials();
  const api = await VrtApi.login(email, password);

  const showcase = await resolveShowcase(api, settings.showcaseProject);
  if (!showcase) {
    const message = `VRT project "${settings.showcaseProject}" not found: its screens are skipped`;
    if (!settings.dry) {
      throw new Error(message);
    }
    console.warn(message);
  }
  const projects = settings.dry ? [] : await targetProjects(api);
  writeRunState({ build: settings.build, showcase, projects });
  await signIn();

  if (projects.length) {
    await MultiProjectTracker.create(projects).start();
  }
  console.log(
    `Build "${settings.build}": scenario ${settings.scenario}, env ${settings.envName}` +
      (settings.bugs ? `, bugs ${settings.bugs}` : "") +
      (settings.dry ? ", dry run (nothing sent)" : `, projects ${settings.projects.join(", ")}`),
  );
}
