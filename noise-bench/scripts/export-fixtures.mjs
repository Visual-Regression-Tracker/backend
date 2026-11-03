#!/usr/bin/env node
// Writes a run's labelled screenshot pairs, with DINOv2 patch distances, into ../test_noise/fixtures:
// node scripts/export-fixtures.mjs --run <run id>
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { apiUrl, config, login, readManifests, ROOT } from "./lib.mjs";

const PATCH = 14;
const TILE_PATCHES = 16;
const FIXTURES = path.resolve(ROOT, "../test_noise/fixtures");
const IMAGES = path.join(FIXTURES, "images");

const runArg = process.argv.indexOf("--run");
const runId = runArg > 0 ? process.argv[runArg + 1] : undefined;
const dinov2Url = process.env.DINOV2_URL?.replace(/\/$/, "");
if (!runId || !dinov2Url) {
  console.error("Usage: DINOV2_URL=<dinov2 service> node scripts/export-fixtures.mjs --run <run id>");
  process.exit(1);
}

const manifests = readManifests().filter(
  (manifest) => ["noise", "change"].includes(manifest.scenario) && !manifest.dry && manifest.build.startsWith(`${runId}-`),
);
if (!manifests.length) {
  console.error(`No noise or change manifests for run ${runId}`);
  process.exit(1);
}

const noiseEnvs = config.calibrationEnvironments;
const screens = [...new Set(manifests.flatMap((manifest) => Object.values(manifest.shots).map((shot) => shot.screen)))];
const selected = (manifest, shot) =>
  manifest.scenario === "change" ||
  shot.env === noiseEnvs[screens.indexOf(shot.screen) % noiseEnvs.length];

async function download(name) {
  const response = await fetch(`${apiUrl}/${name}`);
  if (!response.ok) {
    throw new Error(`GET /${name} returned ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

const images = new Map();
function store(bytes) {
  const file = `${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.png`;
  images.set(file, bytes);
  return file;
}

/** Patches with any differing pixel: the gate can only mark these. */
function changedPatches(baseline, image) {
  const a = PNG.sync.read(baseline);
  const b = PNG.sync.read(image);
  if (a.width !== b.width || a.height !== b.height) {
    return { columns: 0, cells: [] };
  }
  const columns = Math.ceil(a.width / PATCH);
  const cells = new Set();
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const o = (y * a.width + x) * 4;
      if (a.data.readUInt32BE(o) !== b.data.readUInt32BE(o)) {
        cells.add(Math.floor(y / PATCH) * columns + Math.floor(x / PATCH));
      }
    }
  }
  return { columns, cells: [...cells].sort((m, n) => m - n) };
}

async function patchDistances(baseline, image) {
  const { columns, cells } = changedPatches(baseline, image);
  const tiles = new Map();
  for (const cell of cells) {
    const tile = [Math.floor(Math.floor(cell / columns) / TILE_PATCHES), Math.floor((cell % columns) / TILE_PATCHES)];
    tiles.set(tile.join(), tile);
  }
  if (!tiles.size) {
    return { width: columns, height: 0, cells: {} };
  }
  const response = await fetch(`${dinov2Url}/v1/patch-distances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseline: baseline.toString("base64"), image: image.toString("base64"), tiles: [...tiles.values()] }),
  });
  if (!response.ok) {
    throw new Error(`DINOv2 answered ${response.status}: ${await response.text()}`);
  }
  const answer = await response.json();
  return { width: answer.width, height: answer.height, cells: Object.fromEntries(cells.map((cell) => [cell, answer.distances[cell]])) };
}

const health = await fetch(`${dinov2Url}/health`);
if (!health.ok) {
  throw new Error(`DINOv2 health check answered ${health.status}`);
}
const { model } = await health.json();
const api = await login();
const cases = [];
for (const manifest of manifests) {
  const runs = new Map((await api.testRuns(manifest.projects.dinov2.buildId)).map((run) => [run.id, run]));
  for (const shot of Object.values(manifest.shots).filter((shot) => selected(manifest, shot))) {
    const run = runs.get(shot.tracked.dinov2?.testRunId);
    if (!run?.baselineName) {
      console.warn(`${manifest.build} ${shot.name}: no tracked run with a baseline, skipped`);
      continue;
    }
    const [baseline, image] = await Promise.all([download(run.baselineName), download(run.imageName)]);
    cases.push({
      name: `${manifest.build.slice(runId.length + 1)} · ${shot.name}${shot.bugId ? ` · ${shot.bugId}` : ""}`,
      bug: shot.bugId ? { id: shot.bugId, category: shot.category, severity: shot.severity } : null,
      baseline: store(baseline),
      image: store(image),
      dinov2: await patchDistances(baseline, image),
    });
    console.log(`${cases.length}: ${cases.at(-1).name}`);
  }
}
if (!cases.some((c) => !c.bug)) {
  throw new Error(`No noise shots in calibration environments ${noiseEnvs.join(", ")}: nothing to check false alarms on`);
}
fs.rmSync(IMAGES, { recursive: true, force: true });
fs.mkdirSync(IMAGES, { recursive: true });
for (const [file, bytes] of images) {
  fs.writeFileSync(path.join(IMAGES, file), bytes);
}
fs.writeFileSync(
  path.join(FIXTURES, "cases.json"),
  JSON.stringify({ run: runId, dinov2: model, cases }) + "\n",
);
console.log(`${cases.length} cases, ${fs.readdirSync(IMAGES).length} images in ${FIXTURES}`);
