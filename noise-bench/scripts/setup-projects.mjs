// Usage: VRT_DEMO_EMAIL=… VRT_DEMO_PASSWORD=… VRT_DEMO_API_KEY=… [VRT_API_URL=… VRT_UI_URL=…] node scripts/setup-projects.mjs [--reset] [--json]
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.env.VRT_API_URL ?? "http://localhost:4200").replace(/\/$/, "");
const UI = (process.env.VRT_UI_URL ?? "http://localhost:8080").replace(/\/$/, "");
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "showcase-assets", "png");
const args = new Set(process.argv.slice(2));
const RESET = args.has("--reset");
const JSON_OUTPUT = args.has("--json");
const log = JSON_OUTPUT ? (...m) => console.error(...m) : (...m) => console.log(...m);

const PIXELMATCH_DEFAULTS = { threshold: 0.1, ignoreAntialiasing: true, allowDiffDimensions: false };
const PROJECT_DEFAULTS = {
  mainBranchName: "main",
  autoApproveFeature: true,
  imageComparison: "pixelmatch",
  maxBuildAllowed: 100,
  maxBranchLifetime: 30,
  bulkApproveVariations: false,
  bulkApproveGroupBy: "customTags",
};

const PROJECTS = [
  { key: "C0", name: "Noise demo · no filter", config: PIXELMATCH_DEFAULTS },
  { key: "C1", name: "Noise demo · tolerance", config: PIXELMATCH_DEFAULTS },
  { key: "B", name: "Noise demo · filter + DINOv2", config: { ...PIXELMATCH_DEFAULTS, ignoreRenderingNoise: true } },
  { key: "E", name: "Noise demo · own baseline", config: PIXELMATCH_DEFAULTS },
  { key: "E+", name: "Noise demo · own baseline + ignore areas", config: PIXELMATCH_DEFAULTS },
  { key: "showcase", name: "Showcase", config: PIXELMATCH_DEFAULTS },
];

const DESKTOP = { viewport: "1280x800", device: "" };
const MOBILE = { viewport: "390x844", device: "iPhone 13" };
const PAGES = [
  ["Home", "home", DESKTOP],
  ["Home", "home-mobile", MOBILE],
  ["Catalog", "catalog", DESKTOP],
  ["Product details", "product", DESKTOP],
  ["Cart", "cart", DESKTOP],
  ["Checkout", "checkout", DESKTOP],
  ["Sign in", "sign-in", DESKTOP],
  ["Order history", "orders", DESKTOP],
  ["Help center", "help", DESKTOP],
  ["Not found", "not-found", DESKTOP],
];
const CHANGED_IN_LAST_BUILD = new Set(["home", "home-mobile", "product", "cart"]);
const shot = ([name, file, target], v2 = false) => ({ name, file: `${file}${v2 ? ".v2" : ""}.png`, ...target });

const SHOWCASE_BUILDS = [
  { ciBuildId: "fernway-ci-4812", approve: true, shots: PAGES.map((p) => shot(p)) },
  { ciBuildId: "fernway-ci-4819", shots: PAGES.map((p) => shot(p)) },
  {
    ciBuildId: "fernway-ci-4827",
    shots: [...PAGES.map((p) => shot(p, CHANGED_IN_LAST_BUILD.has(p[1]))), shot(["Wishlist", "wishlist", DESKTOP])],
  },
];
const EXPECTED_LAST_BUILD = { unresolved: 4, ok: 6, new: 1 };

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function request(method, path, { token, apiKey, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apiKey) headers.apiKey = apiKey;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : undefined;
}

const sameJson = (a, b) => {
  const sort = (o) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
  return JSON.stringify(sort(a)) === JSON.stringify(sort(b));
};

async function upsertProject(token, existing, spec) {
  const wanted = { ...PROJECT_DEFAULTS, name: spec.name, imageComparisonConfig: JSON.stringify(spec.config) };
  if (!existing) {
    const created = await request("POST", "/projects", { token, body: wanted });
    log(`created  ${spec.name}`);
    return created;
  }
  const drift =
    Object.entries(PROJECT_DEFAULTS).some(([k, v]) => existing[k] !== v) ||
    !sameJson(JSON.parse(existing.imageComparisonConfig), spec.config);
  if (!drift) {
    log(`kept     ${spec.name}`);
    return existing;
  }
  const updated = await request("PUT", "/projects", { token, body: { id: existing.id, ...wanted } });
  log(`updated  ${spec.name}`);
  return updated;
}

async function listBuilds(token, projectId) {
  const page = await request("GET", `/builds?projectId=${projectId}&take=50&skip=0`, { token });
  return page.data;
}

async function seedShowcase(token, apiKey, project) {
  const builds = await listBuilds(token, project.id);
  const wantedIds = SHOWCASE_BUILDS.map((b) => b.ciBuildId);
  if (builds.length > 0) {
    const haveIds = builds.map((b) => b.ciBuildId).sort();
    if (sameJson({ ids: haveIds }, { ids: [...wantedIds].sort() })) {
      log(`kept     Showcase builds (frozen)`);
      return;
    }
    throw new Error(`Showcase holds builds ${haveIds.join(", ")} instead of the seed; re-run with --reset`);
  }

  for (const spec of SHOWCASE_BUILDS) {
    const build = await request("POST", "/builds", {
      apiKey,
      body: { project: project.id, branchName: project.mainBranchName, ciBuildId: spec.ciBuildId },
    });
    const statuses = {};
    for (const s of spec.shots) {
      const imageBase64 = (await readFile(join(ASSETS, s.file))).toString("base64");
      const run = await request("POST", "/test-runs", {
        apiKey,
        body: {
          name: s.name,
          buildId: build.id,
          projectId: project.id,
          branchName: project.mainBranchName,
          browser: "chromium",
          os: "linux",
          viewport: s.viewport,
          device: s.device,
          imageBase64,
        },
      });
      statuses[run.status] = (statuses[run.status] ?? 0) + 1;
    }
    await request("PATCH", `/builds/${build.id}`, { apiKey, body: { isRunning: false } });
    if (spec.approve) await request("PATCH", `/builds/${build.id}/approve?merge=false`, { token });
    log(`seeded   Showcase #${build.number} ${spec.ciBuildId}: ${JSON.stringify(statuses)}${spec.approve ? ", approved" : ""}`);
  }
}

async function showcaseLinks(token, project) {
  const builds = await listBuilds(token, project.id);
  const byCi = Object.fromEntries(builds.map((b) => [b.ciBuildId, b]));
  const [first, clean, mixed] = SHOWCASE_BUILDS.map((b) => byCi[b.ciBuildId]);
  const runs = await request("GET", `/test-runs?buildId=${mixed.id}`, { token });
  const counts = {};
  for (const r of runs) counts[r.status] = (counts[r.status] ?? 0) + 1;
  if (!sameJson(counts, EXPECTED_LAST_BUILD)) {
    log(`WARNING: last Showcase build has ${JSON.stringify(counts)}, expected ${JSON.stringify(EXPECTED_LAST_BUILD)}`);
  }
  const run = (name, viewport = DESKTOP.viewport) => runs.find((r) => r.name === name && r.viewport === viewport);
  const projectUrl = `${UI}/${project.id}`;
  const product = run("Product details");
  return {
    builds: { first: first.id, clean: clean.id, mixed: mixed.id },
    urls: {
      projectList: `${UI}/projects`,
      buildsList: projectUrl,
      mixedBuild: `${projectUrl}?buildId=${mixed.id}`,
      passedBuild: `${projectUrl}?buildId=${clean.id}`,
      approvedFirstBuild: `${projectUrl}?buildId=${first.id}`,
      unresolvedRunProduct: `${projectUrl}?buildId=${mixed.id}&testId=${product.id}`,
      unresolvedRunCart: `${projectUrl}?buildId=${mixed.id}&testId=${run("Cart").id}`,
      unresolvedRunHomeMobile: `${projectUrl}?buildId=${mixed.id}&testId=${run("Home", MOBILE.viewport).id}`,
      newRunWishlist: `${projectUrl}?buildId=${mixed.id}&testId=${run("Wishlist").id}`,
      okRunCatalog: `${projectUrl}?buildId=${mixed.id}&testId=${run("Catalog").id}`,
      variationsList: `${UI}/variations/${project.id}`,
      variationDetailsProduct: `${UI}/variations/details/${product.testVariationId}`,
    },
  };
}

async function main() {
  const login = await request("POST", "/users/login", {
    body: { email: env("VRT_DEMO_EMAIL"), password: env("VRT_DEMO_PASSWORD") },
  });
  const token = login.token;
  const apiKey = env("VRT_DEMO_API_KEY");

  let all = await request("GET", "/projects", { token });
  if (RESET) {
    for (const spec of PROJECTS) {
      const found = all.find((p) => p.name === spec.name);
      if (!found) continue;
      await request("DELETE", `/projects/${found.id}`, { token });
      log(`deleted  ${spec.name}`);
    }
    all = await request("GET", "/projects", { token });
  }

  const ids = {};
  let showcase;
  for (const spec of PROJECTS) {
    const project = await upsertProject(token, all.find((p) => p.name === spec.name), spec);
    ids[spec.name] = project.id;
    if (spec.key === "showcase") showcase = project;
  }
  await seedShowcase(token, apiKey, showcase);

  const stored = await request("GET", "/projects", { token });
  for (const spec of PROJECTS) {
    const p = stored.find((x) => x.id === ids[spec.name]);
    if (!p || !sameJson(JSON.parse(p.imageComparisonConfig), spec.config)) {
      throw new Error(`${spec.name}: stored config does not match the spec`);
    }
  }

  const showcaseInfo = await showcaseLinks(token, showcase);
  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ api: API, ui: UI, projects: ids, showcase: showcaseInfo }, null, 2));
    return;
  }
  console.log("\nProjects:");
  for (const spec of PROJECTS) {
    const p = stored.find((x) => x.id === ids[spec.name]);
    console.log(`  ${spec.key.padEnd(8)} ${spec.name.padEnd(30)} ${p.id}  ${p.imageComparisonConfig}`);
  }
  console.log("\nShowcase pages (sign in first; the settings form is the edit icon on the Showcase card at /projects):");
  for (const [k, url] of Object.entries(showcaseInfo.urls)) console.log(`  ${k.padEnd(24)} ${url}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
