import { INestApplication } from '@nestjs/common';
import { Baseline, Build, Project, TestStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TEST_PROJECT } from '../src/_data_';
import { BuildsService } from '../src/builds/builds.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { TestVariationDto } from '../src/test-variations/dto/test-variation.dto';
import { UsersService } from '../src/users/users.service';
import { createE2eApp, imageExists, pngBuffer, RED, waitFor } from './api-helpers';
import { haveUserLogged, requestWithAuth, LoggedUser } from './preconditions';

describe('TestVariations API (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let projectsService: ProjectsService;
  let buildsService: BuildsService;
  let testRunsService: TestRunsService;
  let prisma: PrismaService;
  let user: LoggedUser;
  let project: Project;

  const WHITE = pngBuffer();
  const CHANGED = pngBuffer([{ x: 5, y: 5, w: 10, h: 10, color: RED }]);

  beforeAll(async () => {
    const created = await createE2eApp();
    app = created.app;
    usersService = created.moduleFixture.get(UsersService);
    projectsService = created.moduleFixture.get(ProjectsService);
    buildsService = created.moduleFixture.get(BuildsService);
    testRunsService = created.moduleFixture.get(TestRunsService);
    prisma = created.moduleFixture.get(PrismaService);
  });

  beforeEach(async () => {
    user = await haveUserLogged(usersService);
    project = await projectsService.create({
      ...TEST_PROJECT,
      autoApproveFeature: false,
      maxBuildAllowed: 100,
      name: `TestVariations API E2E ${randomUUID()}`,
    });
  });

  afterEach(async () => {
    await projectsService.remove(project.id);
    await usersService.delete(user.id);
  });

  afterAll(async () => {
    await app.close();
  });

  const newBuild = (branchName: string): Promise<Build> =>
    buildsService.findOrCreate({ projectId: project.id, branchName });

  const postRun = async (branchName: string, image: Buffer, name = 'Screen') => {
    const build = await newBuild(branchName);
    return testRunsService.postTestRun({
      createTestRequestDto: { projectId: project.id, buildId: build.id, branchName, name },
      imageBuffer: image,
    });
  };

  const haveBaseline = async (branchName: string, image: Buffer, name = 'Screen') => {
    const run = await postRun(branchName, image, name);
    await requestWithAuth(app, 'post', '/test-runs/approve?merge=false', user.token).send([run.id]).expect(200);
    return prisma.testRun.findUnique({ where: { id: run.id } });
  };

  describe('GET /test-variations?projectId=', () => {
    it('lists the variations of every branch of the project', async () => {
      const master = (await haveBaseline(project.mainBranchName, WHITE))!;
      const feature = (await haveBaseline('feature', CHANGED))!;
      const other = await projectsService.create({ ...TEST_PROJECT, name: `Other ${randomUUID()}` });
      try {
        await testRunsService.postTestRun({
          createTestRequestDto: {
            projectId: other.id,
            buildId: (await buildsService.findOrCreate({ projectId: other.id, branchName: 'master' })).id,
            branchName: 'master',
            name: 'Screen',
          },
          imageBuffer: WHITE,
        });

        const res = await requestWithAuth(app, 'get', `/test-variations?projectId=${project.id}`, user.token).expect(
          200
        );

        expect(res.body.map((variation: TestVariationDto) => variation.id).sort()).toEqual(
          [master.testVariationId, feature.testVariationId].sort()
        );
        expect(res.body.map((variation: TestVariationDto) => variation.branchName).sort()).toEqual([
          'feature',
          'master',
        ]);
        expect(res.body[0]).not.toHaveProperty('baselines');
      } finally {
        await projectsService.remove(other.id);
      }
    });

    it('lists them by name, then branch, then browser, whatever order they were created in', async () => {
      for (const variation of [
        { name: 'B', branchName: 'master', browser: 'chrome' },
        { name: 'A', branchName: 'master', browser: 'chrome' },
        { name: 'A', branchName: 'feature', browser: 'firefox' },
      ]) {
        await prisma.testVariation.create({ data: { ...variation, projectId: project.id } });
      }

      const res = await requestWithAuth(app, 'get', `/test-variations?projectId=${project.id}`, user.token).expect(200);

      expect(
        res.body.map(({ name, branchName, browser }: TestVariationDto) => `${name} ${branchName} ${browser}`)
      ).toEqual(['A feature firefox', 'A master chrome', 'B master chrome']);
    });

    it('400 for a projectId that is not a uuid', async () => {
      await requestWithAuth(app, 'get', `/test-variations?projectId=abc`, user.token).expect(400);
    });

    it('401 without a token', async () => {
      await requestWithAuth(app, 'get', `/test-variations?projectId=${project.id}`, '').expect(401);
    });
  });

  describe('GET /test-variations/details/:id', () => {
    it('returns the baseline history, newest first, with run and approving user', async () => {
      const first = (await haveBaseline(project.mainBranchName, WHITE))!;
      const second = (await haveBaseline(project.mainBranchName, CHANGED))!;
      expect(second.testVariationId).toBe(first.testVariationId);

      const res = await requestWithAuth(
        app,
        'get',
        `/test-variations/details/${first.testVariationId}`,
        user.token
      ).expect(200);

      expect(res.body.id).toBe(first.testVariationId);
      expect(res.body.baselines.map((baseline: Baseline) => baseline.testRunId)).toEqual([second.id, first.id]);
      expect(res.body.baselineName).toBe(res.body.baselines[0].baselineName);
      expect(res.body.baselines[0].testRun.id).toBe(second.id);
      expect(res.body.baselines[0].user.id).toBe(user.id);
      expect(res.body.baselines[0].user).toMatchObject({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      expect(res.body.baselines[0].user).not.toHaveProperty('password');
      expect(res.body.baselines[0].user).not.toHaveProperty('apiKey');
    });

    it('404 for an unknown id', async () => {
      const id = randomUUID();

      const res = await requestWithAuth(app, 'get', `/test-variations/details/${id}`, user.token).expect(404);

      expect(res.body.message).toBe(`Test variation not found: ${id}`);
    });

    it('400 for an id that is not a uuid', async () => {
      await requestWithAuth(app, 'get', `/test-variations/details/abc`, user.token).expect(400);
    });
  });

  describe('DELETE /test-variations/:id', () => {
    it('removes the baselines (rows and files) and detaches the runs', async () => {
      const first = (await haveBaseline(project.mainBranchName, WHITE))!;
      const second = (await haveBaseline(project.mainBranchName, CHANGED))!;
      const baselines = await prisma.baseline.findMany({ where: { testVariationId: first.testVariationId! } });
      expect(baselines).toHaveLength(2);
      expect(baselines.every((baseline) => imageExists(baseline.baselineName))).toBe(true);

      const res = await requestWithAuth(app, 'delete', `/test-variations/${first.testVariationId}`, user.token).expect(
        200
      );

      expect(res.body.id).toBe(first.testVariationId);
      expect(await prisma.testVariation.findUnique({ where: { id: first.testVariationId! } })).toBeNull();
      expect(await prisma.baseline.count({ where: { testVariationId: first.testVariationId! } })).toBe(0);
      await waitFor(() => baselines.every((baseline) => !imageExists(baseline.baselineName)));
      const runs = await prisma.testRun.findMany({ where: { id: { in: [first.id, second.id] } } });
      expect(runs.map((run) => run.testVariationId)).toEqual([null, null]);
      expect(runs.every((run) => imageExists(run.imageName))).toBe(true);
    });

    it('the next screenshot of that screen starts over as new', async () => {
      const first = (await haveBaseline(project.mainBranchName, WHITE))!;
      await requestWithAuth(app, 'delete', `/test-variations/${first.testVariationId}`, user.token).expect(200);

      const next = await postRun(project.mainBranchName, WHITE);

      expect(next.status).toBe(TestStatus.new);
      expect(next.testVariationId).not.toBe(first.testVariationId);
    });

    it('404 for an unknown id', async () => {
      await requestWithAuth(app, 'delete', `/test-variations/${randomUUID()}`, user.token).expect(404);
    });

    it('403 for a guest', async () => {
      const first = (await haveBaseline(project.mainBranchName, WHITE))!;
      const guest = await haveUserLogged(usersService, 'guest');
      try {
        await requestWithAuth(app, 'delete', `/test-variations/${first.testVariationId}`, guest.token).expect(403);
      } finally {
        await usersService.delete(guest.id);
      }
      expect(await prisma.testVariation.findUnique({ where: { id: first.testVariationId! } })).not.toBeNull();
    });
  });
});
