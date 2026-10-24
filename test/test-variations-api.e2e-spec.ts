import { INestApplication } from '@nestjs/common';
import { Build, Project, TestStatus } from '@prisma/client';
import uuidAPIKey from 'uuid-apikey';
import { TEST_PROJECT } from '../src/_data_';
import { BuildsService } from '../src/builds/builds.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { UserLoginResponseDto } from '../src/users/dto/user-login-response.dto';
import { UsersService } from '../src/users/users.service';
import { createE2eApp, imageExists, pngBuffer, RED, waitFor } from './api-helpers';
import { haveUserLogged, requestWithAuth } from './preconditions';

describe('TestVariations API (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let projectsService: ProjectsService;
  let buildsService: BuildsService;
  let testRunsService: TestRunsService;
  let prisma: PrismaService;
  let user: UserLoginResponseDto;
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
      name: `TestVariations API E2E ${uuidAPIKey.create().uuid}`,
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

  /** Posts and approves (as the logged-in user), so the variation of that branch gets a baseline. */
  const haveBaseline = async (branchName: string, image: Buffer, name = 'Screen') => {
    const run = await postRun(branchName, image, name);
    await requestWithAuth(app, 'post', '/test-runs/approve?merge=false', user.token).send([run.id]).expect(201);
    return prisma.testRun.findUnique({ where: { id: run.id } });
  };

  describe('GET /test-variations?projectId=', () => {
    it('lists the variations of every branch of the project', async () => {
      const master = await haveBaseline(project.mainBranchName, WHITE);
      const feature = await haveBaseline('feature', CHANGED);
      const other = await projectsService.create({ ...TEST_PROJECT, name: `Other ${uuidAPIKey.create().uuid}` });
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

        expect(res.body.map((variation) => variation.id).sort()).toEqual(
          [master.testVariationId, feature.testVariationId].sort()
        );
        expect(res.body.map((variation) => variation.branchName).sort()).toEqual(['feature', 'master']);
        expect(res.body[0]).not.toHaveProperty('baselines');
      } finally {
        await projectsService.remove(other.id);
      }
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
      const first = await haveBaseline(project.mainBranchName, WHITE);
      const second = await haveBaseline(project.mainBranchName, CHANGED);
      expect(second.testVariationId).toBe(first.testVariationId);

      const res = await requestWithAuth(
        app,
        'get',
        `/test-variations/details/${first.testVariationId}`,
        user.token
      ).expect(200);

      expect(res.body.id).toBe(first.testVariationId);
      expect(res.body.baselines.map((baseline) => baseline.testRunId)).toEqual([second.id, first.id]);
      expect(res.body.baselineName).toBe(res.body.baselines[0].baselineName);
      expect(res.body.baselines[0].testRun.id).toBe(second.id);
      expect(res.body.baselines[0].user.id).toBe(user.id);
      // who approved, but never their credentials: any signed-in user can read this
      expect(res.body.baselines[0].user).toMatchObject({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      expect(res.body.baselines[0].user).not.toHaveProperty('password');
      expect(res.body.baselines[0].user).not.toHaveProperty('apiKey');
    });

    it('unknown id', async () => {
      // NOTE: current behavior — a missing variation is a 200 with an empty body, not a 404
      const res = await requestWithAuth(
        app,
        'get',
        `/test-variations/details/${uuidAPIKey.create().uuid}`,
        user.token
      ).expect(200);

      expect(res.text).toBe('');
    });

    it('400 for an id that is not a uuid', async () => {
      await requestWithAuth(app, 'get', `/test-variations/details/abc`, user.token).expect(400);
    });
  });

  describe('GET /test-variations/merge', () => {
    const merge = (fromBranch: string, toBranch: string, token = user.token) =>
      requestWithAuth(
        app,
        'get',
        `/test-variations/merge?projectId=${project.id}&fromBranch=${fromBranch}&toBranch=${toBranch}`,
        token
      );

    it('re-runs the source branch baselines against the target branch in a new, stopped build', async () => {
      await haveBaseline(project.mainBranchName, WHITE, 'Changed');
      await haveBaseline('feature', CHANGED, 'Changed');
      await haveBaseline(project.mainBranchName, WHITE, 'Same');
      await haveBaseline('feature', WHITE, 'Same');
      await haveBaseline('feature', CHANGED, 'Only on feature');
      // a feature variation that never got a baseline is not merged
      await postRun('feature', WHITE, 'No baseline');

      const res = await merge('feature', project.mainBranchName).expect(200);

      expect(res.body).toMatchObject({
        projectId: project.id,
        branchName: project.mainBranchName,
        isRunning: false,
        merge: true,
        passedCount: 1,
        unresolvedCount: 2,
        failedCount: 0,
      });
      const runs = await prisma.testRun.findMany({ where: { buildId: res.body.id } });
      const byName = Object.fromEntries(runs.map((run) => [run.name, run]));
      expect(Object.keys(byName).sort()).toEqual(['Changed', 'Only on feature', 'Same']);
      expect(byName['Changed']).toMatchObject({ status: TestStatus.unresolved, merge: true, branchName: 'master' });
      expect(byName['Same'].status).toBe(TestStatus.ok);
      expect(byName['Only on feature'].status).toBe(TestStatus.new);
      // a master variation was created for the screen that only existed on feature
      const created = await prisma.testVariation.findUnique({
        where: { id: byName['Only on feature'].testVariationId },
      });
      expect(created).toMatchObject({ branchName: 'master', baselineName: null });
      // the merged screenshot is a stored copy of the feature baseline
      expect(imageExists(byName['Changed'].imageName)).toBe(true);
    });

    it('nothing to merge: an empty stopped build', async () => {
      const res = await merge('nothing-here', project.mainBranchName).expect(200);

      expect(res.body).toMatchObject({ branchName: project.mainBranchName, isRunning: false, merge: false });
      expect(await prisma.testRun.count({ where: { buildId: res.body.id } })).toBe(0);
    });

    it('into a non-main branch whose own variation is older than main', async () => {
      await haveBaseline('release', WHITE);
      await haveBaseline(project.mainBranchName, WHITE);
      await haveBaseline('feature', CHANGED);

      // NOTE: current behavior — find() hands back the newer main-branch variation, so merge tries to create a
      // second 'release' variation and hits the unique constraint: the filter answers 400 with Prisma's message
      // (there is no friendly one for testVariation.create), and the merge build it opened is left running.
      const res = await merge('feature', 'release');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Unique constraint failed');
      expect(await prisma.testVariation.count({ where: { projectId: project.id, branchName: 'release' } })).toBe(1);
      const releaseBuilds = await prisma.build.findMany({ where: { projectId: project.id, branchName: 'release' } });
      expect(releaseBuilds.map((build) => build.isRunning)).toContain(true);
    });

    it('400 without the branches', async () => {
      await requestWithAuth(app, 'get', `/test-variations/merge?projectId=${project.id}`, user.token).expect(400);
    });

    it('400 for a projectId that is not a uuid', async () => {
      await requestWithAuth(
        app,
        'get',
        `/test-variations/merge?projectId=x&fromBranch=a&toBranch=b`,
        user.token
      ).expect(400);
    });

    it('403 for a guest', async () => {
      const guest = await haveUserLogged(usersService, 'guest');
      try {
        await merge('feature', project.mainBranchName, guest.token).expect(403);
      } finally {
        await usersService.delete(guest.id);
      }
    });
  });

  describe('DELETE /test-variations/:id', () => {
    it('removes the baselines (rows and files) and detaches the runs', async () => {
      const first = await haveBaseline(project.mainBranchName, WHITE);
      const second = await haveBaseline(project.mainBranchName, CHANGED);
      const baselines = await prisma.baseline.findMany({ where: { testVariationId: first.testVariationId } });
      expect(baselines).toHaveLength(2);
      expect(baselines.every((baseline) => imageExists(baseline.baselineName))).toBe(true);

      const res = await requestWithAuth(app, 'delete', `/test-variations/${first.testVariationId}`, user.token).expect(
        200
      );

      expect(res.body.id).toBe(first.testVariationId);
      expect(await prisma.testVariation.findUnique({ where: { id: first.testVariationId } })).toBeNull();
      expect(await prisma.baseline.count({ where: { testVariationId: first.testVariationId } })).toBe(0);
      await waitFor(() => baselines.every((baseline) => !imageExists(baseline.baselineName)));
      // the runs stay, without a variation, and keep their own screenshots
      const runs = await prisma.testRun.findMany({ where: { id: { in: [first.id, second.id] } } });
      expect(runs.map((run) => run.testVariationId)).toEqual([null, null]);
      expect(runs.every((run) => imageExists(run.imageName))).toBe(true);
    });

    it('the next screenshot of that screen starts over as new', async () => {
      const first = await haveBaseline(project.mainBranchName, WHITE);
      await requestWithAuth(app, 'delete', `/test-variations/${first.testVariationId}`, user.token).expect(200);

      const next = await postRun(project.mainBranchName, WHITE);

      expect(next.status).toBe(TestStatus.new);
      expect(next.testVariationId).not.toBe(first.testVariationId);
    });

    it('unknown id', async () => {
      // NOTE: current behavior — deleting a missing variation is a 500 (TypeError on the null variation), not a 404
      await requestWithAuth(app, 'delete', `/test-variations/${uuidAPIKey.create().uuid}`, user.token).expect(500);
    });

    it('403 for a guest', async () => {
      const first = await haveBaseline(project.mainBranchName, WHITE);
      const guest = await haveUserLogged(usersService, 'guest');
      try {
        await requestWithAuth(app, 'delete', `/test-variations/${first.testVariationId}`, guest.token).expect(403);
      } finally {
        await usersService.delete(guest.id);
      }
      expect(await prisma.testVariation.findUnique({ where: { id: first.testVariationId } })).not.toBeNull();
    });
  });
});
