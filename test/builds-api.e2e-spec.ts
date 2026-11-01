import { INestApplication } from '@nestjs/common';
import { Build, Project, TestRun, TestStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { BuildDto } from '../src/builds/dto/build.dto';
import { BuildsService } from '../src/builds/builds.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { UsersService } from '../src/users/users.service';
import { CHANGED, createE2eApp, haveProject, imageExists, postRunDirect, WHITE } from './api-helpers';
import { haveUserLogged, requestWithApiKey, requestWithAuth, LoggedUser, withUser } from './preconditions';

describe('Builds API (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let projectsService: ProjectsService;
  let buildsService: BuildsService;
  let testRunsService: TestRunsService;
  let prisma: PrismaService;
  let user: LoggedUser;
  let project: Project;

  beforeAll(async () => {
    const created = await createE2eApp();
    app = created.app;
    usersService = created.get(UsersService);
    projectsService = created.get(ProjectsService);
    buildsService = created.get(BuildsService);
    testRunsService = created.get(TestRunsService);
    prisma = created.get(PrismaService);
  });

  beforeEach(async () => {
    user = await haveUserLogged(usersService);
    project = await haveProject(projectsService, 'Builds API E2E', { autoApproveFeature: false, maxBuildAllowed: 100 });
  });

  afterEach(async () => {
    await buildsService.whenRetentionIdle();
    await projectsService.remove(project.id);
    await usersService.delete(user.id);
  });

  afterAll(async () => {
    await app.close();
  });

  const newBuild = (ciBuildId?: string, projectId = project.id): Promise<Build> =>
    buildsService.findOrCreate({ projectId, branchName: 'master', ciBuildId });

  const postRun = (build: Build, image: Buffer, name?: string) => postRunDirect(testRunsService, build, image, name);

  const createBuild = async (ciBuildId?: string) => {
    const res = await requestWithApiKey(app, 'post', '/builds', user.apiKey)
      .send({ project: project.id, ciBuildId })
      .expect(201);
    await buildsService.whenRetentionIdle();
    return res;
  };

  const listOrder = async (): Promise<string[]> =>
    (
      await prisma.build.findMany({
        where: { projectId: project.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    ).map((build) => build.id);

  const list = (query: string, token = user.token) =>
    requestWithAuth(app, 'get', `/builds?projectId=${project.id}&${query}`, token);

  describe('GET /builds (pagination)', () => {
    let ordered: string[];

    beforeEach(async () => {
      for (const ciBuildId of ['Release-1', 'release-2', 'nightly-3', 'NIGHTLY-4', 'other-5']) {
        await newBuild(ciBuildId);
      }
      ordered = await listOrder();
    });

    it('pages newest first', async () => {
      const first = await list('take=2&skip=0').expect(200);
      const second = await list('take=2&skip=2').expect(200);
      const last = await list('take=2&skip=4').expect(200);

      expect(first.body).toMatchObject({ total: 5, take: 2, skip: 0 });
      expect(first.body.data.map((build: BuildDto) => build.id)).toEqual(ordered.slice(0, 2));
      expect(second.body.data.map((build: BuildDto) => build.id)).toEqual(ordered.slice(2, 4));
      expect(last.body.data.map((build: BuildDto) => build.id)).toEqual(ordered.slice(4));
    });

    it('aroundBuildId opens the page holding that build', async () => {
      const res = await list(`take=2&skip=0&aroundBuildId=${ordered[4]}`).expect(200);
      expect(res.body).toMatchObject({ total: 5, take: 2, skip: 4 });
      expect(res.body.data.map((build: BuildDto) => build.id)).toEqual([ordered[4]]);

      const middle = await list(`take=2&skip=0&aroundBuildId=${ordered[3]}`).expect(200);
      expect(middle.body.skip).toBe(2);
      expect(middle.body.data.map((build: BuildDto) => build.id)).toEqual(ordered.slice(2, 4));
    });

    it('aroundBuildId that holds no page falls back to skip', async () => {
      const otherProject = await haveProject(projectsService, 'Other');
      try {
        const foreign = await newBuild(undefined, otherProject.id);

        for (const aroundBuildId of [randomUUID(), foreign.id]) {
          const res = await list(`take=2&skip=2&aroundBuildId=${aroundBuildId}`).expect(200);
          expect(res.body.skip).toBe(2);
          expect(res.body.data.map((build: BuildDto) => build.id)).toEqual(ordered.slice(2, 4));
        }
      } finally {
        await projectsService.remove(otherProject.id);
      }
    });

    it('aroundBuildId is ignored with take=0', async () => {
      const res = await list(`take=0&skip=1&aroundBuildId=${ordered[4]}`).expect(200);

      expect(res.body).toMatchObject({ total: 5, take: 0, skip: 1, data: [] });
    });

    it('ciBuildId filters by case insensitive substring', async () => {
      const res = await list('take=10&skip=0&ciBuildId=RELEASE').expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.data.map((build: BuildDto) => build.ciBuildId).sort()).toEqual(['Release-1', 'release-2']);
    });

    it('aroundBuildId is resolved within the ciBuildId filter', async () => {
      const nightlyIds = (
        await prisma.build.findMany({ where: { projectId: project.id, ciBuildId: { in: ['nightly-3', 'NIGHTLY-4'] } } })
      ).map((build) => build.id);
      const oldestNightly = ordered.filter((id) => nightlyIds.includes(id)).pop();

      const res = await list(`take=1&skip=0&ciBuildId=nightly&aroundBuildId=${oldestNightly}`).expect(200);
      expect(res.body).toMatchObject({ total: 2, take: 1, skip: 1 });
      expect(res.body.data.map((build: BuildDto) => build.id)).toEqual([oldestNightly]);

      const excluded = await list(`take=1&skip=0&ciBuildId=nightly&aroundBuildId=${ordered[4]}`).expect(200);
      expect(excluded.body.skip).toBe(0);
    });

    it('builds made in the same instant are ordered by id', async () => {
      const createdAt = new Date('2020-01-01T00:00:00.000Z');
      await prisma.build.updateMany({ where: { id: { in: ordered.slice(0, 2) } }, data: { createdAt } });
      const [larger, smaller] = ordered.slice(0, 2).sort().reverse();

      const res = await list('take=10&skip=0').expect(200);
      const around = await list(`take=1&skip=0&aroundBuildId=${smaller}`).expect(200);

      expect(res.body.data.slice(-2).map((build: BuildDto) => build.id)).toEqual([larger, smaller]);
      expect(around.body.skip).toBe(4);
    });

    it('400 for missing take/skip or a malformed aroundBuildId', async () => {
      await list('skip=0').expect(400);
      await list('take=2').expect(400);
      await list('take=two&skip=0').expect(400);
      await list('take=2&skip=0&aroundBuildId=nope').expect(400);
      await list('take=10&skip=-1').expect(400);
    });
  });

  describe('GET /builds stats', () => {
    it('counts passed, unresolved and failed runs and flags merge', async () => {
      const baselineBuild = await newBuild();
      const baselineRun = await postRun(baselineBuild, WHITE, 'Unresolved');
      await testRunsService.approve(baselineRun.id);
      const build = await newBuild();
      await postRun(build, CHANGED, 'Unresolved');
      await postRun(build, WHITE, 'New');
      const failed = await postRun(build, WHITE, 'Failed');
      await requestWithAuth(app, 'post', '/test-runs/reject', user.token).send([failed.id]).expect(201);
      const passed = await postRun(build, WHITE, 'Passed');
      await requestWithAuth(app, 'post', '/test-runs/approve?merge=false', user.token).send([passed.id]).expect(201);

      const res = await requestWithAuth(app, 'get', `/builds/${build.id}`, user.token).expect(200);

      expect(res.body).toMatchObject({ passedCount: 1, unresolvedCount: 2, failedCount: 1, merge: false });
      const listed = await list('take=1&skip=0').expect(200);
      expect(listed.body.data[0]).toMatchObject({ id: build.id, passedCount: 1, unresolvedCount: 2, failedCount: 1 });
    });

    it('404 for an unknown id', async () => {
      const id = randomUUID();

      const res = await requestWithAuth(app, 'get', `/builds/${id}`, user.token).expect(404);

      expect(res.body.message).toBe(`Build not found: ${id}`);
    });
  });

  describe('DELETE /builds/:id', () => {
    it('removes the build, its runs and their files but keeps baselines', async () => {
      const baselineBuild = await newBuild();
      const baselineRun = await postRun(baselineBuild, WHITE);
      await testRunsService.approve(baselineRun.id);
      const build = await newBuild();
      const run = await postRun(build, CHANGED);
      expect(run.status).toBe(TestStatus.unresolved);
      const stored = (await prisma.testRun.findUnique({ where: { id: run.id } }))!;
      const files = [stored.imageName, stored.diffName, stored.imageThumbnailName, stored.diffThumbnailName];
      expect(files.every((name) => imageExists(name))).toBe(true);

      const res = await requestWithAuth(app, 'delete', `/builds/${build.id}`, user.token).expect(200);

      expect(res.body.id).toBe(build.id);
      expect(res.body.testRuns.map((testRun: TestRun) => testRun.id)).toEqual([run.id]);
      expect(await prisma.build.findUnique({ where: { id: build.id } })).toBeNull();
      expect(await prisma.testRun.count({ where: { buildId: build.id } })).toBe(0);
      expect(files.some((name) => imageExists(name))).toBe(false);
      expect(imageExists(stored.baselineName)).toBe(true);
    });

    it('deleting the build that produced a baseline keeps the baseline, detached from its run', async () => {
      const build = await newBuild();
      const run = await postRun(build, WHITE);
      await testRunsService.approve(run.id);
      const baseline = (await prisma.baseline.findUnique({ where: { testRunId: run.id } }))!;

      await requestWithAuth(app, 'delete', `/builds/${build.id}`, user.token).expect(200);

      const after = (await prisma.baseline.findUnique({ where: { id: baseline.id } }))!;
      expect(after.testRunId).toBeNull();
      expect(imageExists(after.baselineName)).toBe(true);
    });

    it('404 for an unknown id', async () => {
      await requestWithAuth(app, 'delete', `/builds/${randomUUID()}`, user.token).expect(404);
    });

    it('403 for a guest', async () => {
      const build = await newBuild();
      await withUser(usersService, 'guest', (guest) =>
        requestWithAuth(app, 'delete', `/builds/${build.id}`, guest.token).expect(403)
      );
      expect(await prisma.build.findUnique({ where: { id: build.id } })).not.toBeNull();
    });
  });

  describe('PATCH /builds/:id/approve', () => {
    it('approves every new and unresolved run, leaving rejected ones', async () => {
      const baselineBuild = await newBuild();
      const baselineRun = await postRun(baselineBuild, WHITE, 'Unresolved');
      await testRunsService.approve(baselineRun.id);
      const build = await newBuild();
      const unresolved = await postRun(build, CHANGED, 'Unresolved');
      const fresh = await postRun(build, WHITE, 'New');
      const failed = await postRun(build, WHITE, 'Failed');
      await prisma.testRun.update({ where: { id: failed.id }, data: { status: TestStatus.failed } });

      await requestWithAuth(app, 'patch', `/builds/${build.id}/approve?merge=false`, user.token).expect(200);

      const statuses = Object.fromEntries(
        (await prisma.testRun.findMany({ where: { buildId: build.id } })).map((run) => [run.id, run.status])
      );
      expect(statuses).toEqual({
        [unresolved.id]: TestStatus.approved,
        [fresh.id]: TestStatus.approved,
        [failed.id]: TestStatus.failed,
      });
      const baselines = await prisma.baseline.findMany({ where: { testRunId: { in: [unresolved.id, fresh.id] } } });
      expect(baselines.map((baseline) => baseline.userId)).toEqual([user.id, user.id]);
    });

    it('400 without merge', async () => {
      const build = await newBuild();

      await requestWithAuth(app, 'patch', `/builds/${build.id}/approve`, user.token).expect(400);
    });

    it('404 for an unknown id', async () => {
      await requestWithAuth(app, 'patch', `/builds/${randomUUID()}/approve?merge=false`, user.token).expect(404);
    });

    it('403 for a guest', async () => {
      const build = await newBuild();
      await withUser(usersService, 'guest', (guest) =>
        requestWithAuth(app, 'patch', `/builds/${build.id}/approve?merge=false`, guest.token).expect(403)
      );
    });
  });

  describe('PATCH /builds/:id', () => {
    it('stops the build and sets a CI build id', async () => {
      const build = await newBuild();

      const res = await requestWithApiKey(app, 'patch', `/builds/${build.id}`, user.apiKey)
        .send({ isRunning: false, ciBuildId: 'ci-77' })
        .expect(200);

      expect(res.body).toMatchObject({ id: build.id, isRunning: false, ciBuildId: 'ci-77' });
    });

    it('400 for other build columns, leaving the build as it was', async () => {
      const build = await newBuild();

      const res = await requestWithApiKey(app, 'patch', `/builds/${build.id}`, user.apiKey)
        .send({ branchName: 'rewritten', number: 4242 })
        .expect(400);

      expect(res.body.message).toContain('property branchName should not exist');
      expect(await prisma.build.findUnique({ where: { id: build.id } })).toMatchObject({
        branchName: build.branchName,
        number: build.number,
        isRunning: true,
      });
    });

    it('400 for a value of the wrong type', async () => {
      const build = await newBuild();

      await requestWithApiKey(app, 'patch', `/builds/${build.id}`, user.apiKey).send({ isRunning: 'no' }).expect(400);
    });

    it('a CI build id already used by another build of the project', async () => {
      await newBuild('taken');
      const build = await newBuild();

      const res = await requestWithApiKey(app, 'patch', `/builds/${build.id}`, user.apiKey)
        .send({ ciBuildId: 'taken' })
        .expect(400);

      expect(res.body.message).toBe('There is already a build with this ci build id.');
    });

    it('404 for an unknown id', async () => {
      await requestWithApiKey(app, 'patch', `/builds/${randomUUID()}`, user.apiKey)
        .send({ isRunning: false })
        .expect(404);
    });
  });

  describe('POST /builds retention (maxBuildAllowed)', () => {
    beforeAll(() => {
      process.env.BUILD_RETENTION_GRACE_MINUTES = '0';
    });

    afterAll(() => {
      delete process.env.BUILD_RETENTION_GRACE_MINUTES;
    });

    it('keeps at most maxBuildAllowed builds and removes the files of the dropped ones', async () => {
      await prisma.project.update({ where: { id: project.id }, data: { maxBuildAllowed: 2 } });
      const oldest = (await createBuild()).body;
      const run = await postRun({ ...oldest, projectId: project.id } as Build, WHITE);
      await createBuild();

      const newest = (await createBuild()).body;

      const remaining = await listOrder();
      expect(remaining).toHaveLength(2);
      expect(remaining[0]).toBe(newest.id);
      expect(remaining).not.toContain(oldest.id);
      expect(imageExists(run.imageName)).toBe(false);
    });

    it('maxBuildAllowed=1 keeps only the newest build', async () => {
      await prisma.project.update({ where: { id: project.id }, data: { maxBuildAllowed: 1 } });

      await createBuild();
      await createBuild();
      const newest = (await createBuild()).body;

      expect(await listOrder()).toEqual([newest.id]);
    });

    it('never prunes the build a CI build id reuses, and counts it as one of those kept', async () => {
      await prisma.project.update({ where: { id: project.id }, data: { maxBuildAllowed: 2 } });
      const joinShared = () => createBuild('shared');
      const shared = (await joinShared()).body;
      const newer = (await createBuild()).body;

      const joined = (await joinShared()).body;

      expect(joined.id).toBe(shared.id);
      expect((await listOrder()).sort()).toEqual([shared.id, newer.id].sort());
    });
  });

  describe('POST /builds retention of builds in use', () => {
    it('spares a build that is still receiving test runs', async () => {
      await prisma.project.update({ where: { id: project.id }, data: { maxBuildAllowed: 1 } });
      const live = (await createBuild()).body;
      await postRun({ ...live, projectId: project.id } as Build, WHITE);

      const newest = (await createBuild()).body;

      expect((await listOrder()).sort()).toEqual([live.id, newest.id].sort());
    });

    it('removes a build idle for longer than the grace period', async () => {
      await prisma.project.update({ where: { id: project.id }, data: { maxBuildAllowed: 1 } });
      const idle = (await createBuild()).body;
      await postRun({ ...idle, projectId: project.id } as Build, WHITE);
      const then = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await prisma.$executeRaw`UPDATE "Build" SET "updatedAt" = ${then} WHERE "id" = ${idle.id}`;
      await prisma.testRun.updateMany({ where: { buildId: idle.id }, data: { createdAt: then } });

      const newest = (await createBuild()).body;

      expect(await listOrder()).toEqual([newest.id]);
    });
  });
});
