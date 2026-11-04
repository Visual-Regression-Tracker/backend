import { VisualRegressionTracker } from "@visual-regression-tracker/sdk-js";
import type { TargetProject } from "./run-state";
import { credentials, settings, type ProjectKey } from "./settings";

export const BROWSER = "chromium";

export interface TrackedRun {
  testRunId: string;
  status: string;
  diffPercent: number | null;
}

/**
 * One sdk-js client per demo project, all in builds sharing the run's ciBuildId.
 * `track` sends the one screenshot buffer to every project, so the projects
 * compare identical bytes and differ only in their comparison settings.
 */
export class MultiProjectTracker {
  private constructor(private clients: { project: TargetProject; vrt: VisualRegressionTracker }[]) {}

  static create(projects: TargetProject[]) {
    const { apiKey } = credentials();
    if (!apiKey) {
      throw new Error("Set VRT_DEMO_API_KEY to send screenshots to VRT");
    }
    return new MultiProjectTracker(
      projects.map((project) => ({
        project,
        vrt: new VisualRegressionTracker({
          apiUrl: settings.apiUrl,
          apiKey,
          project: project.name,
          branchName: project.branch,
          ciBuildId: settings.build,
          // a diff is data here, not a failure
          enableSoftAssert: true,
        }),
      })),
    );
  }

  /** Starts, or joins by ciBuildId, the run's build in every project; returns their ids. */
  async start(): Promise<Partial<Record<ProjectKey, string>>> {
    const builds = await Promise.all(this.clients.map(({ vrt }) => vrt.start()));
    return Object.fromEntries(builds.map((build, i) => [this.clients[i].project.key, build.id]));
  }

  async stop() {
    await Promise.all(this.clients.map(({ vrt }) => vrt.stop()));
  }

  async track(name: string, image: Buffer, viewport: string): Promise<Partial<Record<ProjectKey, TrackedRun>>> {
    const results = await Promise.all(
      this.clients.map(({ project, vrt }) =>
        vrt.track(
          {
            name,
            imageBuffer: image,
            // own-baseline projects key the variation by environment, so each one compares with its own baseline
            browser: project.key.startsWith("ownenv") ? settings.envName : BROWSER,
            viewport,
            diffTollerancePercent: project.key === "tolerance" ? settings.tolerance : 0,
          },
          // no retries: a retry re-sends the same image and only adds test runs
          0,
        ),
      ),
    );
    return Object.fromEntries(
      results.map(({ testRunResponse: run }, i) => [
        this.clients[i].project.key,
        { testRunId: run.id, status: run.status, diffPercent: run.diffPercent ?? null },
      ]),
    );
  }
}
