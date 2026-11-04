import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test as base, type Page } from "@playwright/test";
import { bugsByScreen, selectBugs, type Bug } from "./bugs";
import { countDifferentPixels } from "./pixels";
import { fileName, readRunState, shotsDir, writePart, type RunState } from "./run-state";
import { screens, type Screen } from "./screens";
import { settings, type Theme } from "./settings";
import { freeze, settle, shoot } from "./stabilize";
import { MultiProjectTracker } from "./tracker";

const test = base.extend<{}, { run: RunState; tracker: MultiProjectTracker | null }>({
  run: [async ({}, use) => use(readRunState()), { scope: "worker" }],
  tracker: [
    async ({ run }, use) => {
      if (settings.dry) {
        return use(null);
      }
      const tracker = MultiProjectTracker.create(run.projects);
      await tracker.start();
      await use(tracker);
    },
    { scope: "worker" },
  ],
});

const VIEWPORT = "1280x800";
const injected = settings.scenario === "change" ? bugsByScreen(selectBugs(settings.bugs)) : new Map<string, Bug>();
const selected = screens.filter((screen) => !settings.screens || settings.screens.includes(screen.id));

const render = async (page: Page, screen: Screen, run: RunState, bug?: Bug): Promise<Buffer> => {
  await freeze(page);
  await screen.open(page, run.showcase!);
  await settle(page);
  if (bug) {
    await bug.apply(page);
    await settle(page);
  }
  return shoot(page, screen.target?.(page));
};

const saveImage = (name: string, image: Buffer) => {
  fs.mkdirSync(shotsDir(), { recursive: true });
  fs.writeFileSync(path.join(shotsDir(), `${fileName(name)}.png`), image);
};

for (const theme of settings.themes as Theme[]) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme });

    for (const screen of selected) {
      const name = `${screen.id} [${theme}]`;

      test(name, async ({ page, run, tracker }) => {
        const missing = run.showcase ? screen.needs.filter((key) => !run.showcase![key]) : ["Showcase project"];
        test.skip(missing.length > 0, `Showcase lacks: ${missing.join(", ")}`);

        if (settings.scenario === "verify") {
          return verifyBugs(page, screen, run, name);
        }

        const bug = injected.get(screen.id);
        const image = await render(page, screen, run, bug);
        if (settings.dry) {
          saveImage(name, image);
        }
        writePart({
          name,
          screen: screen.id,
          theme,
          env: settings.envName,
          bugId: bug?.id ?? null,
          category: bug?.category ?? null,
          severity: bug?.severity ?? null,
          sha256: createHash("sha256").update(image).digest("hex"),
          tracked: tracker ? await tracker.track(name, image, VIEWPORT) : {},
        });
      });
    }
  });
}

/** Renders the screen clean twice (a stability check) and once per catalogued bug; every bug must change pixels. */
async function verifyBugs(page: Page, screen: Screen, run: RunState, name: string) {
  const clean = await render(page, screen, run);
  const again = await render(page, screen, run);
  saveImage(name, clean);
  const checks = [];
  for (const bug of selectBugs("all").filter((candidate) => candidate.screen === screen.id)) {
    const image = await render(page, screen, run, bug);
    saveImage(`${name} ${bug.id}`, image);
    checks.push({ bugId: bug.id, differentPixels: countDifferentPixels(clean, image) });
  }
  const unstablePixels = countDifferentPixels(clean, again);
  if (unstablePixels) {
    saveImage(`${name} again`, again);
  }
  fs.mkdirSync(path.join(shotsDir(), "checks"), { recursive: true });
  fs.writeFileSync(
    path.join(shotsDir(), "checks", `${fileName(name)}.json`),
    JSON.stringify({ name, screen: screen.id, unstablePixels, checks }),
  );
}
