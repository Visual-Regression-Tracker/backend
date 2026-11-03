import fs from "node:fs";
import path from "node:path";
import { RESULTS_DIR, RUN_STATE, settings, type ProjectKey } from "./settings";
import type { ShowcaseIds } from "./showcase";

export interface TargetProject {
  key: ProjectKey;
  name: string;
  id: string;
  branch: string;
}

/** What global setup resolved once for the whole run and the workers read. */
export interface RunState {
  build: string;
  showcase?: ShowcaseIds;
  projects: TargetProject[];
}

export const writeRunState = (state: RunState) => {
  fs.mkdirSync(path.dirname(RUN_STATE), { recursive: true });
  fs.writeFileSync(RUN_STATE, JSON.stringify(state, null, 2));
};

export const readRunState = (): RunState => JSON.parse(fs.readFileSync(RUN_STATE, "utf8"));

/** Ground truth for one screenshot: what was rendered, where, and which bug (if any) it carries. */
export interface ShotRecord {
  name: string;
  screen: string;
  theme: string;
  env: string;
  bugId: string | null;
  category: string | null;
  severity: string | null;
  sha256: string;
  tracked: Partial<Record<ProjectKey, { testRunId: string; status: string; diffPercent: number | null }>>;
}

export interface Manifest {
  build: string;
  scenario: string;
  env: string;
  bugs: string;
  tolerance: number;
  dry: boolean;
  createdAt: string;
  projects: Partial<Record<ProjectKey, { id: string; name: string; buildId?: string }>>;
  shots: Record<string, ShotRecord>;
}

export const partsDir = (build = settings.build) => path.join(RESULTS_DIR, ".parts", build);
export const manifestPath = (build = settings.build) => path.join(RESULTS_DIR, `manifest-${build}.json`);
export const shotsDir = (build = settings.build) => path.join(RESULTS_DIR, "shots", build);

export const fileName = (name: string) => name.replace(/[^\w.-]+/g, "_");

export const writePart = (record: ShotRecord) => {
  fs.mkdirSync(partsDir(), { recursive: true });
  fs.writeFileSync(path.join(partsDir(), `${fileName(record.name)}.json`), JSON.stringify(record));
};

export const readParts = <T = ShotRecord>(dir = partsDir()): T[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")))
    : [];
