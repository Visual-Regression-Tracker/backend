import { settings } from "./settings";

export interface Project {
  id: string;
  name: string;
  mainBranchName: string;
}

export interface Build {
  id: string;
  number: number;
  ciBuildId: string | null;
  status: string;
  passedCount: number;
  unresolvedCount: number;
  failedCount: number;
}

export interface TestRun {
  id: string;
  name: string;
  status: string;
  diffPercent: number | null;
  diffName: string | null;
}

export interface TestVariation {
  id: string;
  name: string;
}

/** The REST calls the demo needs, as the signed-in demo user (the read endpoints take a JWT, not the API key). */
export class VrtApi {
  private constructor(private token: string) {}

  static async login(email: string, password: string): Promise<VrtApi> {
    const response = await fetch(`${settings.apiUrl}/users/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      throw new Error(`Login to ${settings.apiUrl} failed with ${response.status}`);
    }
    const { token } = (await response.json()) as { token: string };
    return new VrtApi(token);
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${settings.apiUrl}${path}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      throw new Error(`GET ${path} returned ${response.status}`);
    }
    return (await response.json()) as T;
  }

  projects() {
    return this.get<Project[]>("/projects");
  }

  async projectByName(name: string): Promise<Project | undefined> {
    return (await this.projects()).find((project) => project.name === name);
  }

  async builds(projectId: string): Promise<Build[]> {
    const page = await this.get<{ data: Build[] }>(`/builds?projectId=${projectId}&take=100&skip=0`);
    return page.data;
  }

  testRuns(buildId: string) {
    return this.get<TestRun[]>(`/test-runs?buildId=${buildId}`);
  }

  testVariations(projectId: string) {
    return this.get<TestVariation[]>(`/test-variations?projectId=${projectId}`);
  }
}
