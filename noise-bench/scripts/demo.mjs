#!/usr/bin/env node
// Runs the experiment: node scripts/demo.mjs <baseline|calibrate|noise|change|verify|all> [args]
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  bugSetNames,
  config,
  login,
  noiseEnvironments,
  PROJECT_KEYS,
  readManifest,
  readState,
  ROOT,
  runSuite,
  writeState,
} from "./lib.mjs";

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
const runId = process.env.DEMO_RUN ?? stamp();
const buildName = (...parts) => [runId, ...parts].join("-");

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function baseline() {
  const build = buildName("baseline", "reference");
  if (!runSuite({ DEMO_SCENARIO: "baseline", DEMO_ENV: "reference", DEMO_BUILD: build })) {
    fail("The baseline run had failing tests: fix them before approving, or the later builds miss baselines");
  }
  const manifest = readManifest(build);
  const api = await login();
  for (const [key, project] of Object.entries(manifest.projects)) {
    await api.approveBuild(project.buildId);
    const runs = await api.testRuns(project.buildId);
    const notApproved = runs.filter((run) => !["approved", "ok", "autoApproved"].includes(run.status));
    console.log(
      `${key}: approved build ${project.buildId} (${runs.length} runs)` +
        (notApproved.length ? `, NOT approved: ${notApproved.map((run) => `${run.name}=${run.status}`).join(", ")}` : ""),
    );
  }
  writeState({ baselineBuild: build });
}

const OWN = ["ownenv", "ownenvia"];
const ownEnvs = config.ownBaselineEnvironments ?? [];
/** Projects an environment's runs go to: the own-baseline ones only where that environment has a baseline. */
const projectsFor = (env) => PROJECT_KEYS.filter((key) => !OWN.includes(key) || ownEnvs.includes(env)).join(",");

/** Each environment's own baseline in the own-baseline projects; the ignore areas go on the second one's variations. */
async function own() {
  const api = await login();
  for (const env of ownEnvs) {
    const build = buildName("own-baseline", env);
    if (!runSuite({ DEMO_SCENARIO: "baseline", DEMO_ENV: env, DEMO_BUILD: build, DEMO_PROJECTS: OWN.join(",") })) {
      fail(`The own baseline run in ${env} had failing tests`);
    }
    const manifest = readManifest(build);
    for (const [key, project] of Object.entries(manifest.projects)) {
      await api.approveBuild(project.buildId);
      if (key !== "ownenvia") continue;
      const areas = config.ownIgnoreAreas?.[env] ?? {};
      for (const shot of Object.values(manifest.shots)) {
        if (areas[shot.screen]) {
          await api.updateIgnoreAreas([shot.tracked[key].testRunId], areas[shot.screen]);
          console.log(`${key}: ignore areas on ${env} / ${shot.name}`);
        }
      }
    }
  }
}

/** Noise runs into "no filter" only; the tolerance project then gets the largest noise diff, rounded up. */
async function calibrate(envs = config.calibrationEnvironments) {
  let max = 0;
  const builds = [];
  for (const env of envs) {
    const build = buildName("calibration", env);
    runSuite({ DEMO_SCENARIO: "calibration", DEMO_ENV: env, DEMO_BUILD: build, DEMO_PROJECTS: "nofilter" });
    builds.push(build);
    for (const shot of Object.values(readManifest(build).shots)) {
      max = Math.max(max, shot.tracked.nofilter?.diffPercent ?? 0);
    }
  }
  const step = config.toleranceStep;
  const tolerance = Math.max(step, Math.ceil(max / step) * step);
  const rounded = Number(tolerance.toFixed(6));
  console.log(`Largest noise diff ${max}% → DEMO_TOLERANCE=${rounded}`);
  return writeState({ tolerance: rounded, maxNoiseDiffPercent: max, calibrationBuilds: builds });
}

function tolerance() {
  const value = process.env.DEMO_TOLERANCE ?? readState().tolerance;
  if (value === undefined) {
    fail("No tolerance yet: run `npm run demo:calibrate` or set DEMO_TOLERANCE");
  }
  return String(value);
}

function noise(env) {
  if (!env) fail("Usage: npm run demo:noise -- <env>");
  return runSuite({
    DEMO_SCENARIO: "noise",
    DEMO_ENV: env,
    DEMO_BUILD: buildName("noise", env),
    DEMO_PROJECTS: projectsFor(env),
    DEMO_TOLERANCE: tolerance(),
  });
}

function change(env, bugs) {
  if (!env || !bugs) fail("Usage: npm run demo:change -- <env> <bug set, e.g. set1 | bug ids, comma-separated>");
  return runSuite({
    DEMO_SCENARIO: "change",
    DEMO_ENV: env,
    DEMO_BUGS: bugs,
    DEMO_BUILD: buildName("change", env, bugs.replace(/[^\w-]+/g, "+")),
    DEMO_PROJECTS: projectsFor(env),
    DEMO_TOLERANCE: tolerance(),
  });
}

function verify(env = "reference") {
  return runSuite({ DEMO_SCENARIO: "verify", DEMO_ENV: env, DEMO_BUILD: buildName("verify", env) });
}

async function all() {
  console.log(`Run ${runId}: noise environments ${noiseEnvironments.join(", ")}`);
  if (process.env.DEMO_SKIP_BASELINE !== "1") {
    await baseline();
  }
  await own();
  if (process.env.DEMO_SKIP_CALIBRATION !== "1") {
    await calibrate();
  }
  for (const env of noiseEnvironments) {
    noise(env);
  }
  bugSetNames.forEach((set, i) => {
    change(config.changeEnvironments[i % config.changeEnvironments.length], set);
  });
  spawnSync("node", [path.join(ROOT, "scripts", "report.mjs"), "--run", runId], { stdio: "inherit" });
}

const [command, ...args] = process.argv.slice(2);
const commands = {
  baseline,
  own,
  calibrate: () => calibrate(args.length ? args : undefined),
  noise: () => noise(args[0]),
  change: () => change(args[0], args[1]),
  verify: () => verify(args[0]),
  all,
};
if (!commands[command]) {
  fail(`Usage: node scripts/demo.mjs <${Object.keys(commands).join("|")}> [args]`);
}
await commands[command]();
