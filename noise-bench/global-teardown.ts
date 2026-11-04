import fs from "node:fs";
import path from "node:path";
import { manifestPath, readParts, readRunState, shotsDir, type Manifest } from "./src/run-state";
import { RESULTS_DIR, settings } from "./src/settings";
import { MultiProjectTracker } from "./src/tracker";

interface BugCheck {
  name: string;
  screen: string;
  unstablePixels: number;
  checks: { bugId: string; differentPixels: number }[];
}

function writeBugCheck() {
  const results = readParts<BugCheck>(path.join(shotsDir(), "checks"));
  const identical = results.flatMap((result) =>
    result.checks.filter((check) => check.differentPixels === 0).map((check) => `${check.bugId} on ${result.name}`),
  );
  const unstable = results.filter((result) => result.unstablePixels > 0).map((result) => result.name);
  const file = path.join(RESULTS_DIR, `bug-check-${settings.envName}.json`);
  fs.writeFileSync(file, JSON.stringify({ env: settings.envName, identical, unstable, results }, null, 2));
  console.log(`Bug check written to ${file}`);
  console.log(identical.length ? `Bugs that render identical: ${identical.join(", ")}` : "Every bug changes the rendering");
  console.log(unstable.length ? `Screens that differ between two clean renders: ${unstable.join(", ")}` : "Every screen renders stably");
}

export default async function globalTeardown() {
  if (settings.scenario === "verify") {
    return writeBugCheck();
  }
  const run = readRunState();
  const buildIds = run.projects.length ? await stopBuilds(run.projects) : {};
  const manifest: Manifest = {
    build: settings.build,
    scenario: settings.scenario,
    env: settings.envName,
    bugs: settings.bugs,
    tolerance: settings.tolerance,
    dry: settings.dry,
    createdAt: new Date().toISOString(),
    projects: Object.fromEntries(
      run.projects.map((project) => [project.key, { id: project.id, name: project.name, buildId: buildIds[project.key] }]),
    ),
    shots: Object.fromEntries(readParts().map((shot) => [shot.name, shot])),
  };
  fs.writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2));
  console.log(`Manifest of ${Object.keys(manifest.shots).length} screenshots written to ${manifestPath()}`);
}

async function stopBuilds(projects: ReturnType<typeof readRunState>["projects"]) {
  const tracker = MultiProjectTracker.create(projects);
  const ids = await tracker.start();
  await tracker.stop();
  return ids;
}
