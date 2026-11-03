import type { VrtApi } from "./vrt-api";

/** The ids of the frozen "Showcase" project the screens open, looked up by name before every run. */
export interface ShowcaseIds {
  projectId: string;
  name: string;
  mixedBuildId?: string;
  passedBuildId?: string;
  unresolvedRunId?: string;
  okRunId?: string;
  variationId?: string;
}

const PASSED = new Set(["ok", "approved", "autoApproved"]);

export async function resolveShowcase(api: VrtApi, name: string): Promise<ShowcaseIds | undefined> {
  const project = await api.projectByName(name);
  if (!project) {
    return undefined;
  }
  const builds = await api.builds(project.id);
  const mixed = builds.find((build) => build.unresolvedCount > 0 && build.passedCount > 0) ?? builds[0];
  const passed = builds.find((build) => build.id !== mixed?.id && build.status === "passed");
  const runs = mixed ? await api.testRuns(mixed.id) : [];
  const byName = <T extends { name: string }>(items: T[]) =>
    [...items].sort((a, b) => a.name.localeCompare(b.name));
  const variations = byName(await api.testVariations(project.id));

  return {
    projectId: project.id,
    name: project.name,
    mixedBuildId: mixed?.id,
    passedBuildId: passed?.id,
    unresolvedRunId: byName(runs).find((run) => run.status === "unresolved" && run.diffName)?.id,
    okRunId: byName(runs).find((run) => PASSED.has(run.status))?.id,
    variationId: variations[0]?.id,
  };
}
