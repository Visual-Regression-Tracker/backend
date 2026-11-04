#!/usr/bin/env node
// Joins the ground-truth manifests with what VRT decided: node scripts/report.mjs [--run <run id prefix>]
import fs from "node:fs";
import path from "node:path";
import { buildLink, config, login, PROJECT_KEYS, readManifests, readState, RESULTS_DIR } from "./lib.mjs";

const FLAGGED = new Set(["unresolved", "failed"]);
const PASSED = new Set(["ok", "autoApproved"]);
const DECIDED = new Set(["approved", "rejected"]);
const EVALUATED = new Set(["noise", "change"]);

const runArg = process.argv.indexOf("--run");
const runPrefix = runArg > 0 ? process.argv[runArg + 1] : undefined;

const manifests = readManifests().filter(
  (manifest) => EVALUATED.has(manifest.scenario) && !manifest.dry && (!runPrefix || manifest.build.startsWith(runPrefix)),
);
if (!manifests.length) {
  console.error(`No noise or change manifests${runPrefix ? ` for run ${runPrefix}` : ""} in ${RESULTS_DIR}`);
  process.exit(1);
}

const api = await login();

/** One row per (screenshot, project): what was rendered and how VRT judged it. */
const observations = [];
for (const manifest of manifests) {
  for (const [key, project] of Object.entries(manifest.projects)) {
    const runs = new Map((await api.testRuns(project.buildId)).map((run) => [run.name, run]));
    for (const shot of Object.values(manifest.shots)) {
      const run = runs.get(shot.name);
      const tracked = shot.tracked[key];
      // a reviewer's later approve/reject replaces the status; the comparison's own verdict is in the manifest
      const status = !run ? "missing" : DECIDED.has(run.status) && tracked ? tracked.status : run.status;
      observations.push({
        project: key,
        build: manifest.build,
        scenario: manifest.scenario,
        env: shot.env,
        name: shot.name,
        screen: shot.screen,
        theme: shot.theme,
        bugId: shot.bugId,
        category: shot.category,
        severity: shot.severity,
        status,
        diffPercent: run?.diffPercent ?? tracked?.diffPercent ?? null,
        link: buildLink(project.id, project.buildId, run?.id),
      });
    }
  }
}

const pct = (part, whole) => (whole ? Math.round((1000 * part) / whole) / 10 : null);
const countBy = (items, key) =>
  items.reduce((groups, item) => {
    (groups[item[key]] ??= []).push(item);
    return groups;
  }, {});

function bugStats(items) {
  const caught = items.filter((o) => FLAGGED.has(o.status)).length;
  const missed = items.filter((o) => PASSED.has(o.status)).length;
  return { shots: items.length, caught, missed, recallPercent: pct(caught, caught + missed) };
}

const projects = PROJECT_KEYS.filter((key) => observations.some((o) => o.project === key)).map((key) => {
  const own = observations.filter((o) => o.project === key);
  const noise = own.filter((o) => !o.bugId);
  const withBug = own.filter((o) => o.bugId);
  const falseAlarms = noise.filter((o) => FLAGGED.has(o.status)).length;
  const bugs = bugStats(withBug);
  return {
    key,
    name: config.projects[key],
    noise: {
      shots: noise.length,
      falseAlarms,
      falseAlarmPercent: pct(falseAlarms, noise.length),
      passedDespiteDiff: noise.filter((o) => PASSED.has(o.status) && o.diffPercent > 0).length,
      byEnv: Object.fromEntries(
        Object.entries(countBy(noise, "env")).map(([env, items]) => {
          const alarms = items.filter((o) => FLAGGED.has(o.status)).length;
          return [env, { shots: items.length, falseAlarms: alarms, falseAlarmPercent: pct(alarms, items.length) }];
        }),
      ),
    },
    bugs: {
      ...bugs,
      bySeverity: Object.fromEntries(Object.entries(countBy(withBug, "severity")).map(([k, v]) => [k, bugStats(v)])),
      byCategory: Object.fromEntries(Object.entries(countBy(withBug, "category")).map(([k, v]) => [k, bugStats(v)])),
    },
    precisionPercent: pct(bugs.caught, bugs.caught + falseAlarms),
    noBaseline: own.filter((o) => o.status === "new").length,
    missing: own.filter((o) => o.status === "missing").length,
  };
});

/** Bug screenshots project A passed and project B flagged, for every ordered pair. */
const shotKey = (o) => `${o.build}|${o.name}`;
const indexed = new Map();
for (const o of observations.filter((o) => o.bugId)) {
  indexed.set(`${o.project}|${shotKey(o)}`, o);
}
const missedVsCaught = [];
for (const a of projects) {
  for (const b of projects) {
    if (a.key === b.key) continue;
    const items = observations
      .filter((o) => o.project === a.key && o.bugId && PASSED.has(o.status))
      .map((o) => ({ a: o, b: indexed.get(`${b.key}|${shotKey(o)}`) }))
      .filter(({ b: other }) => other && FLAGGED.has(other.status))
      .map(({ a: missed, b: caught }) => ({
        bugId: missed.bugId,
        screenshot: missed.name,
        env: missed.env,
        severity: missed.severity,
        category: missed.category,
        diffPercent: caught.diffPercent,
        missedIn: missed.link,
        caughtIn: caught.link,
      }));
    if (items.length) missedVsCaught.push({ missedBy: a.key, caughtBy: b.key, items });
  }
}
const builds = manifests.map((manifest) => ({
  build: manifest.build,
  scenario: manifest.scenario,
  env: manifest.env,
  bugs: manifest.bugs || null,
  tolerance: manifest.tolerance,
  links: Object.fromEntries(Object.entries(manifest.projects).map(([key, p]) => [key, buildLink(p.id, p.buildId)])),
}));

const state = readState();
const report = {
  generatedAt: new Date().toISOString(),
  run: runPrefix ?? null,
  tolerancePercent: state.tolerance ?? manifests[0].tolerance,
  maxCalibrationNoisePercent: state.maxNoiseDiffPercent ?? null,
  projects,
  missedVsCaught,
  builds,
  observations,
};
fs.writeFileSync(path.join(RESULTS_DIR, "report.json"), JSON.stringify(report, null, 2));

const cell = (value) => (value === null || value === undefined ? "–" : String(value));
const table = (head, rows) =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => " --- ").join("|")}|`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join(
    "\n",
  );
const short = (key) => config.projects[key];
const groups = (field) => [...new Set(projects.flatMap((p) => Object.keys(p.bugs[field])))].sort();

const md = [
  "# Rendering-noise filter: results",
  "",
  `Generated ${report.generatedAt}${runPrefix ? ` for run \`${runPrefix}\`` : ""}. ` +
    `Tolerance project: diffTollerancePercent = ${cell(report.tolerancePercent)}%` +
    (report.maxCalibrationNoisePercent !== null ? ` (largest calibration noise diff ${report.maxCalibrationNoisePercent}%).` : "."),
  "",
  "A screenshot counts as **flagged** when VRT marks it unresolved (or failed), as **passed** when ok.",
  "Noise-only screenshots carry no bug, so every flag on them is a false alarm.",
  "",
  "## Summary",
  "",
  table(
    ["Project", "Noise-only shots", "False alarms", "False alarm %", "Bug shots", "Caught", "Missed", "Recall %", "Precision %"],
    projects.map((p) => [
      short(p.key),
      p.noise.shots,
      p.noise.falseAlarms,
      p.noise.falseAlarmPercent,
      p.bugs.shots,
      p.bugs.caught,
      p.bugs.missed,
      p.bugs.recallPercent,
      p.precisionPercent,
    ]),
  ),
  "",
  "## False alarms by render environment",
  "",
  table(
    ["Environment", ...projects.map((p) => short(p.key))],
    [...new Set(projects.flatMap((p) => Object.keys(p.noise.byEnv)))].map((env) => [
      env,
      ...projects.map((p) => {
        const e = p.noise.byEnv[env];
        return e ? `${e.falseAlarms}/${e.shots} (${cell(e.falseAlarmPercent)}%)` : "–";
      }),
    ]),
  ),
  "",
  "## Bugs caught by severity",
  "",
  table(
    ["Severity", ...projects.map((p) => short(p.key))],
    groups("bySeverity").map((g) => [
      g,
      ...projects.map((p) => {
        const s = p.bugs.bySeverity[g];
        return s ? `${s.caught}/${s.shots} (${cell(s.recallPercent)}%)` : "–";
      }),
    ]),
  ),
  "",
  "## Bugs caught by category",
  "",
  table(
    ["Category", ...projects.map((p) => short(p.key))],
    groups("byCategory").map((g) => [
      g,
      ...projects.map((p) => {
        const s = p.bugs.byCategory[g];
        return s ? `${s.caught}/${s.shots}` : "–";
      }),
    ]),
  ),
  "",
  "## Bugs missed by one project and caught by another",
  "",
  ...(missedVsCaught.length
    ? missedVsCaught.flatMap(({ missedBy, caughtBy, items }) => [
        `### Missed by ${short(missedBy)}, caught by ${short(caughtBy)} (${items.length})`,
        "",
        table(
          ["Bug", "Screenshot", "Env", "Severity", "Diff %", "Missed", "Caught"],
          items.map((i) => [i.bugId, i.screenshot, i.env, i.severity, i.diffPercent?.toFixed(3), `[run](${i.missedIn})`, `[run](${i.caughtIn})`]),
        ),
        "",
      ])
    : ["None.", ""]),
  "## Builds",
  "",
  table(
    ["Build", "Scenario", "Env", "Bugs", ...PROJECT_KEYS.map(short)],
    builds.map((b) => [b.build, b.scenario, b.env, b.bugs, ...PROJECT_KEYS.map((key) => (b.links[key] ? `[open](${b.links[key]})` : "–"))]),
  ),
  "",
];
const problems = projects.filter((p) => p.noBaseline || p.missing);
if (problems.length) {
  md.push(
    "## Data problems",
    "",
    ...problems.map((p) => `- ${short(p.key)}: ${p.noBaseline} screenshots without a baseline, ${p.missing} not found in VRT`),
    "",
  );
}
fs.writeFileSync(path.join(RESULTS_DIR, "report.md"), md.join("\n"));
console.log(`Report written to ${path.join(RESULTS_DIR, "report.md")} and report.json`);
