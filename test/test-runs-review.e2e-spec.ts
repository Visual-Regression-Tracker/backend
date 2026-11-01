import { INestApplication } from '@nestjs/common';
import { Build, Project, TestStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { BuildsService } from '../src/builds/builds.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';
import { TestRunDto } from '../src/test-runs/dto/testRun.dto';
import { UsersService } from '../src/users/users.service';
import {
  approveRuns,
  BLUE,
  createE2eApp,
  haveProject,
  imageExists,
  pngBuffer,
  postRunBase64,
  redAt,
  TEST_RUN_DTO_KEYS,
  waitFor,
  WHITE,
} from './api-helpers';
import { haveUserLogged, requestWithApiKey, requestWithAuth, LoggedUser, withUser } from './preconditions';

describe('TestRuns review API (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let projectsService: ProjectsService;
  let buildsService: BuildsService;
  let prisma: PrismaService;
  let user: LoggedUser;
  let project: Project;

  beforeAll(async () => {
    const created = await createE2eApp();
    app = created.app;
    usersService = created.get(UsersService);
    projectsService = created.get(ProjectsService);
    buildsService = created.get(BuildsService);
    prisma = created.get(PrismaService);
  });

  beforeEach(async () => {
    user = await haveUserLogged(usersService);
    project = await haveProject(projectsService, 'TestRuns review E2E', {
      autoApproveFeature: false,
      maxBuildAllowed: 100,
    });
  });

  afterEach(async () => {
    await projectsService.remove(project.id);
    await usersService.delete(user.id);
  });

  afterAll(async () => {
    await app.close();
  });

  const newBuild = (branchName = project.mainBranchName): Promise<Build> =>
    buildsService.findOrCreate({ projectId: project.id, branchName });

  const postRun = (build: Build, image: Buffer, extra: Record<string, unknown> = {}) =>
    postRunBase64(app, user, build, image, extra);

  const variationOf = async (id: string) => (await prisma.testVariation.findUnique({ where: { id } }))!;
  const runOf = async (id: string) => (await prisma.testRun.findUnique({ where: { id } }))!;

  const approve = (ids: string[], merge = false) => approveRuns(app, user, ids, merge);

  const runAgainstBaseline = async (
    build: Build,
    baseline: Buffer,
    image: Buffer,
    extra: Record<string, unknown> = {}
  ): Promise<Record<string, any>> => {
    const baselineBuild = await newBuild();
    const first = await postRun(baselineBuild, baseline, extra);
    await approve([first.id]);
    return postRun(build, image, extra);
  };

  it.each([
    ['approve', 'post', '/test-runs/approve?merge=false', (id: string) => [id]],
    ['reject', 'post', '/test-runs/reject', (id: string) => [id]],
    ['revert', 'post', '/test-runs/revert', (id: string) => [id]],
    ['delete', 'post', '/test-runs/delete', (id: string) => [id]],
    ['update', 'patch', '/test-runs/update/:id', () => ({ comment: 'x' })],
  ] as const)('403 for a guest on %s', async (_name, method, url, body) => {
    const run = await postRun(await newBuild(), WHITE);

    await withUser(usersService, 'guest', (guest) =>
      requestWithAuth(app, method, url.replace(':id', run.id), guest.token).send(body(run.id)).expect(403)
    );

    expect((await runOf(run.id)).status).toBe(TestStatus.new);
  });

  describe('POST /test-runs (base64)', () => {
    it('creates a new run and stores the image on disk', async () => {
      const build = await newBuild();

      const body = await postRun(build, WHITE, { os: 'mac', comment: 'first' });

      expect(body.status).toBe(TestStatus.new);
      expect(body.os).toBe('mac');
      expect(body.comment).toBe('first');
      expect(body.url).toBe(`${process.env.APP_FRONTEND_URL}/${project.id}?buildId=${build.id}&testId=${body.id}`);
      expect(imageExists(body.imageName)).toBe(true);
    });

    it('400 for a body that is not base64', async () => {
      const build = await newBuild();

      await requestWithApiKey(app, 'post', '/test-runs', user.apiKey)
        .send({
          projectId: project.id,
          buildId: build.id,
          branchName: build.branchName,
          name: 'Screen',
          imageBase64: '%%%',
        })
        .expect(400);
    });

    it('403 without an API key', async () => {
      await requestWithApiKey(app, 'post', '/test-runs', '').send({}).expect(403);
    });

    it('parallel builds uploading the same brand-new screen all succeed', async () => {
      const builds = await Promise.all(Array.from({ length: 8 }, () => newBuild()));

      await Promise.all(builds.map((build) => postRun(build, WHITE, { name: 'Brand new screen' })));

      expect(await prisma.testVariation.count({ where: { projectId: project.id, name: 'Brand new screen' } })).toBe(1);
    });
  });

  describe('GET /test-runs?buildId=', () => {
    it('lists the runs of the build as TestRunDto', async () => {
      const build = await newBuild();
      const otherBuild = await newBuild();
      const a = await postRun(build, WHITE, { name: 'A' });
      const b = await postRun(build, WHITE, { name: 'B' });
      await postRun(otherBuild, WHITE, { name: 'C' });

      const res = await requestWithAuth(app, 'get', `/test-runs?buildId=${build.id}`, user.token).expect(200);

      expect(res.body.map((run: TestRunDto) => run.id).sort()).toEqual([a.id, b.id].sort());
      expect(Object.keys(res.body[0]).sort()).toEqual(TEST_RUN_DTO_KEYS);
    });

    it('empty list for a build without runs', async () => {
      const build = await newBuild();

      await requestWithAuth(app, 'get', `/test-runs?buildId=${build.id}`, user.token).expect(200).expect([]);
    });

    it('400 for a buildId that is not a uuid', async () => {
      await requestWithAuth(app, 'get', `/test-runs?buildId=nope`, user.token).expect(400);
    });

    it('401 without a token', async () => {
      const build = await newBuild();

      await requestWithAuth(app, 'get', `/test-runs?buildId=${build.id}`, '').expect(401);
    });
  });

  describe('GET /test-runs/:id', () => {
    it('returns the run with its test variation and all DB columns', async () => {
      const build = await newBuild();
      const run = await postRun(build, WHITE, { browser: 'firefox' });

      const res = await requestWithAuth(app, 'get', `/test-runs/${run.id}`, user.token).expect(200);

      expect(res.body.id).toBe(run.id);
      expect(res.body.browser).toBe('firefox');
      expect(res.body.testVariation.id).toBe(run.testVariationId);
      expect(res.body.testVariation.browser).toBe('firefox');
      expect(res.body).toHaveProperty('pixelMisMatchCount');
      expect(res.body).toHaveProperty('changeSignature');
      expect(res.body.projectId).toBe(project.id);
    });

    it('404 for an unknown id', async () => {
      const id = randomUUID();

      const res = await requestWithAuth(app, 'get', `/test-runs/${id}`, user.token).expect(404);

      expect(res.body.message).toBe(`Test run not found: ${id}`);
    });

    it('400 for an id that is not a uuid', async () => {
      await requestWithAuth(app, 'get', `/test-runs/123`, user.token).expect(400);
    });
  });

  describe('POST /test-runs/approve', () => {
    it('approves, records the approving user and copies the image to a new baseline file', async () => {
      const build = await newBuild();
      const run = await postRun(build, WHITE);

      await approve([run.id]);

      const stored = await runOf(run.id);
      expect(stored.status).toBe(TestStatus.approved);
      const variation = (await prisma.testVariation.findUnique({
        where: { id: run.testVariationId },
        include: { baselines: true },
      }))!;
      expect(variation.baselines).toHaveLength(1);
      expect(variation.baselines[0]).toMatchObject({ testRunId: run.id, userId: user.id });
      expect(variation.baselineName).toBe(variation.baselines[0].baselineName);
      expect(variation.baselineName).not.toBe(run.imageName);
      expect(variation.baselineName).toMatch(/\.baseline\.png$/);
      expect(imageExists(variation.baselineName)).toBe(true);
    });

    it('feature branch: approve creates a branch variation carrying comment and ignore areas', async () => {
      const masterBuild = await newBuild();
      const masterRun = await postRun(masterBuild, WHITE);
      await approve([masterRun.id]);
      const featureBuild = await newBuild('feature');
      const featureRun = await postRun(featureBuild, pngBuffer([redAt(0, 0)]), { comment: 'feature comment' });
      expect(featureRun.status).toBe(TestStatus.unresolved);

      await approve([featureRun.id]);

      const stored = await runOf(featureRun.id);
      expect(stored.status).toBe(TestStatus.approved);
      expect(stored.testVariationId).not.toBe(masterRun.testVariationId);
      const featureVariation = (await prisma.testVariation.findUnique({
        where: { id: stored.testVariationId! },
        include: { baselines: true },
      }))!;
      expect(featureVariation.branchName).toBe('feature');
      expect(featureVariation.comment).toBe('feature comment');
      expect(featureVariation.baselines).toHaveLength(1);
      expect(await prisma.baseline.count({ where: { testVariationId: masterRun.testVariationId } })).toBe(1);
    });

    it('merge=true on a feature branch adds the baseline to the master variation', async () => {
      const masterBuild = await newBuild();
      const masterRun = await postRun(masterBuild, WHITE);
      await approve([masterRun.id]);
      const featureBuild = await newBuild('feature');
      const featureRun = await postRun(featureBuild, pngBuffer([redAt(0, 0)]), { merge: true });

      await approve([featureRun.id], true);

      const stored = await runOf(featureRun.id);
      expect(stored.status).toBe(TestStatus.approved);
      expect(stored.merge).toBe(true);
      expect(stored.testVariationId).toBe(masterRun.testVariationId);
      expect(await prisma.baseline.count({ where: { testVariationId: masterRun.testVariationId } })).toBe(2);
      expect(await prisma.testVariation.count({ where: { projectId: project.id, branchName: 'feature' } })).toBe(0);
    });

    it('feature branch: an existing feature variation older than master is reused on approve', async () => {
      const featureBaseline = await postRun(await newBuild('feature'), WHITE);
      await approve([featureBaseline.id]);
      const masterBaseline = await postRun(await newBuild(), WHITE);
      await approve([masterBaseline.id]);
      const featureRun = await postRun(await newBuild('feature'), pngBuffer([redAt(0, 0)]));
      expect(featureRun.testVariationId).toBe(masterBaseline.testVariationId);
      expect(featureRun.baselineBranchName).toBe(project.mainBranchName);

      await approve([featureRun.id]);

      const stored = await runOf(featureRun.id);
      expect(stored.testVariationId).toBe(featureBaseline.testVariationId);
      expect(await prisma.baseline.count({ where: { testVariationId: featureBaseline.testVariationId } })).toBe(2);
      expect(await prisma.baseline.count({ where: { testVariationId: masterBaseline.testVariationId } })).toBe(1);
    });

    it('approving a feature-branch run twice keeps one baseline', async () => {
      const masterRun = await postRun(await newBuild(), WHITE);
      await approve([masterRun.id]);
      const featureRun = await postRun(await newBuild('feature'), pngBuffer([redAt(0, 0)]));
      await approve([featureRun.id]);
      const { testVariationId } = await runOf(featureRun.id);
      const { baselineName } = await variationOf(testVariationId!);

      await approve([featureRun.id]);

      const baselines = await prisma.baseline.findMany({ where: { testVariationId: testVariationId! } });
      expect(baselines).toHaveLength(1);
      expect(baselines[0].testRunId).toBe(featureRun.id);
      expect((await variationOf(testVariationId!)).baselineName).toBe(baselineName);
    });

    it('a run whose variation was deleted', async () => {
      const run = await postRun(await newBuild(), WHITE);
      await requestWithAuth(app, 'delete', `/test-variations/${run.testVariationId}`, user.token).expect(200);

      const res = await requestWithAuth(app, 'post', `/test-runs/approve?merge=false`, user.token)
        .send([run.id])
        .expect(200);

      expect(res.body).toEqual({
        succeeded: [],
        failed: [{ id: run.id, message: 'No test variation found. Re-create test run' }],
      });
      expect((await runOf(run.id)).status).toBe(TestStatus.new);
    });

    it('400 without the merge query parameter', async () => {
      const build = await newBuild();
      const run = await postRun(build, WHITE);

      await requestWithAuth(app, 'post', `/test-runs/approve`, user.token).send([run.id]).expect(400);

      expect((await runOf(run.id)).status).toBe(TestStatus.new);
    });

    it('approves the ids it can and reports each unknown id as sent', async () => {
      const run = await postRun(await newBuild(), WHITE);
      const unknown = randomUUID().toUpperCase();

      const res = await requestWithAuth(app, 'post', `/test-runs/approve?merge=false`, user.token)
        .send([unknown, run.id])
        .expect(200);

      expect(res.body).toEqual({
        succeeded: [run.id],
        failed: [{ id: unknown, message: `Test run not found: ${unknown}` }],
      });
      expect((await runOf(run.id)).status).toBe(TestStatus.approved);
    });
  });

  describe('POST /test-runs/reject', () => {
    it('marks the runs failed', async () => {
      const build = await newBuild();
      const a = await postRun(build, WHITE, { name: 'A' });
      const b = await postRun(build, WHITE, { name: 'B' });

      const res = await requestWithAuth(app, 'post', `/test-runs/reject`, user.token).send([a.id, b.id]).expect(200);

      expect(res.body).toEqual({ succeeded: [a.id, b.id], failed: [] });

      const runs = await prisma.testRun.findMany({ where: { buildId: build.id } });
      expect(runs.map((run) => run.status)).toEqual([TestStatus.failed, TestStatus.failed]);
      expect(await prisma.baseline.count({ where: { testVariation: { projectId: project.id } } })).toBe(0);
    });
  });

  describe('POST /test-runs/revert', () => {
    const revert = (ids: string[], token = user.token) =>
      requestWithAuth(app, 'post', '/test-runs/revert', token).send(ids);

    it('approve, then revert: the variation gets its previous baseline back and the run its status', async () => {
      const run = await runAgainstBaseline(await newBuild(), WHITE, pngBuffer([redAt(0, 0)]));
      expect(run.status).toBe(TestStatus.unresolved);
      const before = await variationOf(run.testVariationId);
      await approve([run.id]);
      const approvedName = (await variationOf(run.testVariationId)).baselineName!;
      expect(approvedName).not.toBe(before.baselineName);
      expect(imageExists(approvedName)).toBe(true);

      await revert([run.id]).expect(204);

      expect((await variationOf(run.testVariationId)).baselineName).toBe(before.baselineName);
      const stored = await runOf(run.id);
      expect(stored.status).toBe(TestStatus.unresolved);
      expect(stored.statusBeforeDecision).toBeNull();
      expect(await prisma.baseline.count({ where: { testRunId: run.id } })).toBe(0);
      expect(await prisma.baseline.count({ where: { testVariationId: run.testVariationId } })).toBe(1);
      expect(imageExists(approvedName)).toBe(false);
      expect(imageExists(before.baselineName)).toBe(true);
    });

    it('reject, then revert: the status is restored', async () => {
      const run = await runAgainstBaseline(await newBuild(), WHITE, pngBuffer([redAt(0, 0)]));
      await requestWithAuth(app, 'post', '/test-runs/reject', user.token).send([run.id]).expect(200);
      expect((await runOf(run.id)).status).toBe(TestStatus.failed);

      await revert([run.id]).expect(204);

      expect((await runOf(run.id)).status).toBe(TestStatus.unresolved);
    });

    it('two approvals of one screen: reverting the first is a 409 and nothing changes', async () => {
      const first = await postRun(await newBuild(), WHITE);
      await approve([first.id]);
      const second = await postRun(await newBuild(), pngBuffer([redAt(0, 0)]));
      await approve([second.id]);
      const variationBefore = await variationOf(first.testVariationId);

      const res = await revert([first.id]).expect(409);

      expect(res.body.message).toContain(first.id);
      expect(await variationOf(first.testVariationId)).toEqual(variationBefore);
      expect((await runOf(first.id)).status).toBe(TestStatus.approved);
      expect((await runOf(second.id)).status).toBe(TestStatus.approved);
      expect(await prisma.baseline.count({ where: { testVariationId: first.testVariationId } })).toBe(2);
      expect(imageExists(variationBefore.baselineName)).toBe(true);
    });

    it('two approvals of one screen are reverted in one request, latest first', async () => {
      const first = await postRun(await newBuild(), WHITE);
      await approve([first.id]);
      const second = await postRun(await newBuild(), pngBuffer([redAt(0, 0)]));
      await approve([second.id]);

      await revert([first.id, second.id]).expect(204);

      expect((await variationOf(first.testVariationId)).baselineName).toBeNull();
      expect(await prisma.baseline.count({ where: { testVariationId: first.testVariationId } })).toBe(0);
      expect((await runOf(first.id)).status).toBe(TestStatus.new);
      expect((await runOf(second.id)).status).toBe(TestStatus.unresolved);
    });

    it('a feature-branch approval: the feature variation it created is deleted and the run is back on main', async () => {
      const masterRun = await postRun(await newBuild(), WHITE);
      await approve([masterRun.id]);
      const featureRun = await postRun(await newBuild('feature'), pngBuffer([redAt(0, 0)]));
      await approve([featureRun.id]);
      const featureVariationId = (await runOf(featureRun.id)).testVariationId!;
      expect(featureVariationId).not.toBe(masterRun.testVariationId);
      const featureBaselineName = (await variationOf(featureVariationId)).baselineName!;

      await revert([featureRun.id]).expect(204);

      const stored = await runOf(featureRun.id);
      expect(stored.testVariationId).toBe(masterRun.testVariationId);
      expect(stored.status).toBe(TestStatus.unresolved);
      expect(await prisma.testVariation.count({ where: { projectId: project.id, branchName: 'feature' } })).toBe(0);
      expect(imageExists(featureBaselineName)).toBe(false);
      expect(await prisma.baseline.count({ where: { testVariationId: masterRun.testVariationId } })).toBe(1);
    });

    it('409 for a run that was not decided', async () => {
      const run = await postRun(await newBuild(), WHITE);

      const res = await revert([run.id]).expect(409);

      expect(res.body.message).toContain(run.id);
    });

    it('409 for an empty list', async () => {
      await revert([]).expect(409);
    });

    it('404 for an unknown id', async () => {
      await revert([randomUUID()]).expect(404);
    });

    it('400 for an id that is not a uuid', async () => {
      const run = await postRun(await newBuild(), WHITE);

      await revert([run.id, 'not-a-uuid']).expect(400);
    });
  });

  describe('POST /test-runs/delete', () => {
    it('removes the rows and the screenshot, diff and thumbnail files', async () => {
      const build = await newBuild();
      const run = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5)]));
      expect(run.status).toBe(TestStatus.unresolved);
      const stored = await runOf(run.id);
      const files = [stored.imageName, stored.diffName, stored.imageThumbnailName, stored.diffThumbnailName];
      expect(files.every((name) => imageExists(name))).toBe(true);
      const baselineName = stored.baselineName;

      await requestWithAuth(app, 'post', `/test-runs/delete`, user.token).send([run.id]).expect(200);

      expect(await prisma.testRun.findUnique({ where: { id: run.id } })).toBeNull();
      expect(files.some((name) => imageExists(name))).toBe(false);
      expect(imageExists(baselineName)).toBe(true);
    });

    it('counts an id that does not exist as deleted', async () => {
      const id = randomUUID();

      const res = await requestWithAuth(app, 'post', `/test-runs/delete`, user.token).send([id]).expect(200);

      expect(res.body).toEqual({ succeeded: [id], failed: [] });
    });
  });

  describe('POST /test-runs/ignoreAreas/*', () => {
    const area = { x: 0, y: 0, width: 30, height: 30 };
    const otherArea = { x: 30, y: 30, width: 30, height: 30 };
    const setAreas = (action: 'update' | 'add', ids: string[], ignoreAreas: unknown[]) =>
      requestWithAuth(app, 'post', `/test-runs/ignoreAreas/${action}`, user.token).send({ ids, ignoreAreas });

    it('update: stores the areas on run and variation and recomputes the diff', async () => {
      const build = await newBuild();
      const run = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5)]));
      expect(run.status).toBe(TestStatus.unresolved);
      const before = await runOf(run.id);

      await setAreas('update', [run.id], [area]).expect(201);

      const after = (await prisma.testRun.findUnique({ where: { id: run.id }, include: { testVariation: true } }))!;
      expect(JSON.parse(after.ignoreAreas)).toEqual([area]);
      expect(JSON.parse(after.testVariation!.ignoreAreas)).toEqual([area]);
      expect(after.status).toBe(TestStatus.ok);
      expect(after.diffName).toBeNull();
      expect(after.imageThumbnailName).toBeNull();
      expect(after.diffThumbnailName).toBeNull();
      expect(after.changeSignature).toBeNull();
      await waitFor(
        () => ![before.diffName, before.imageThumbnailName, before.diffThumbnailName].some((name) => imageExists(name))
      );
    });

    it('update replaces, add appends', async () => {
      const build = await newBuild();
      const run = await postRun(build, WHITE);

      await setAreas('update', [run.id], [area]).expect(201);
      await setAreas('add', [run.id], [otherArea]).expect(201);

      const stored = (await prisma.testRun.findUnique({ where: { id: run.id }, include: { testVariation: true } }))!;
      expect(JSON.parse(stored.ignoreAreas)).toEqual([area, otherArea]);
      expect(JSON.parse(stored.testVariation!.ignoreAreas)).toEqual([area, otherArea]);
      expect(stored.status).toBe(TestStatus.new);

      await setAreas('update', [run.id], []).expect(201);

      const cleared = await runOf(run.id);
      expect(JSON.parse(cleared.ignoreAreas)).toEqual([]);
    });

    it('temp ignore areas sent with the screenshot mask the change but are not stored on the variation', async () => {
      const build = await newBuild();
      const run = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5)]), {});
      expect(run.status).toBe(TestStatus.unresolved);

      const masked = await postRun(build, pngBuffer([redAt(5, 5)]), { ignoreAreas: [area] });

      expect(masked.status).toBe(TestStatus.ok);
      const stored = (await prisma.testRun.findUnique({ where: { id: masked.id }, include: { testVariation: true } }))!;
      expect(JSON.parse(stored.tempIgnoreAreas)).toEqual([area]);
      expect(JSON.parse(stored.ignoreAreas)).toEqual([]);
      expect(JSON.parse(stored.testVariation!.ignoreAreas)).toEqual([]);
      expect(await prisma.testRun.findUnique({ where: { id: run.id } })).toBeNull();
    });

    it('400 for an invalid area', async () => {
      const build = await newBuild();
      const run = await postRun(build, WHITE);

      await setAreas('update', [run.id], [{ ...area, x: 'left' }]).expect(400);
    });

    it('404 for an unknown id', async () => {
      await setAreas('update', [randomUUID()], [area]).expect(404);
    });
  });

  describe('PATCH /test-runs/update/:id', () => {
    it('sets the comment on the run and on its variation', async () => {
      const build = await newBuild();
      const run = await postRun(build, WHITE);

      const res = await requestWithAuth(app, 'patch', `/test-runs/update/${run.id}`, user.token)
        .send({ comment: 'looks fine' })
        .expect(200);

      expect(res.body.comment).toBe('looks fine');
      const variation = await variationOf(run.testVariationId);
      expect(variation.comment).toBe('looks fine');
    });

    it('only the comment reaches the variation', async () => {
      const run = await postRun(await newBuild(), WHITE);
      await approve([run.id]);
      const before = await variationOf(run.testVariationId);

      await requestWithAuth(app, 'patch', `/test-runs/update/${run.id}`, user.token)
        .send({ comment: 'x', baselineName: 'evil.png', ignoreAreas: 'not json' })
        .expect(200);

      const after = await variationOf(run.testVariationId);
      expect(after.comment).toBe('x');
      expect(after.baselineName).toBe(before.baselineName);
      expect(after.ignoreAreas).toBe(before.ignoreAreas);
    });

    it('the variation comment is the default for the next run', async () => {
      const build = await newBuild();
      const run = await postRun(build, WHITE);
      await requestWithAuth(app, 'patch', `/test-runs/update/${run.id}`, user.token)
        .send({ comment: 'carried over' })
        .expect(200);

      const next = await postRun(await newBuild(), WHITE);

      expect(next.comment).toBe('carried over');
    });

    it('400 without a comment', async () => {
      const build = await newBuild();
      const run = await postRun(build, WHITE);

      await requestWithAuth(app, 'patch', `/test-runs/update/${run.id}`, user.token).send({}).expect(400);
    });
  });

  describe('GET /test-runs/matchingSiblings/:id', () => {
    const matching = (id: string) => requestWithAuth(app, 'get', `/test-runs/matchingSiblings/${id}`, user.token);
    const enableBulkApprove = (groupBy?: string) =>
      prisma.project.update({
        where: { id: project.id },
        data: { bulkApproveVariations: true, ...(groupBy !== undefined && { bulkApproveGroupBy: groupBy }) },
      });
    const byTag = (list: Array<{ customTags: string; reason?: string }>) =>
      [...list].sort((a, b) => a.customTags.localeCompare(b.customTags));
    const idsOf = (res: { body: { variations: TestRunDto[] } }) => res.body.variations.map((run) => run.id);
    const skippedOf = (res: { body: { skipped: Array<{ customTags: string; reason?: string }> } }) =>
      byTag(res.body.skipped).map((run) => [run.customTags, run.reason]);

    const haveLocalesBuild = async () => {
      const build = await newBuild();
      const en = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5)]), { customTags: 'en' });
      const de = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(40, 40)]), { customTags: 'de' });
      const fr = await runAgainstBaseline(build, WHITE, pngBuffer([{ x: 5, y: 5, w: 10, h: 10, color: BLUE }]), {
        customTags: 'fr',
      });
      const es = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5, 30)]), { customTags: 'es' });
      const it_ = await runAgainstBaseline(build, WHITE, WHITE, { customTags: 'it' });
      const pt = await postRun(build, pngBuffer([redAt(5, 5)]), { customTags: 'pt' });
      const otherOs = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5)]), {
        customTags: 'de',
        os: 'mac',
      });
      const otherName = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5)]), {
        customTags: 'de',
        name: 'Other screen',
      });
      expect([en, de, fr, es].map((run) => run.status)).toEqual(Array(4).fill(TestStatus.unresolved));
      expect(it_.status).toBe(TestStatus.ok);
      expect(pt.status).toBe(TestStatus.new);
      expect([otherOs, otherName].map((run) => run.status)).toEqual([TestStatus.unresolved, TestStatus.unresolved]);
      return { build, en, de, fr, es, it: it_, pt };
    };

    it('bulk approve disabled on the project: only the run itself', async () => {
      const build = await newBuild();
      const en = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5)]), { customTags: 'en' });
      await runAgainstBaseline(build, WHITE, pngBuffer([redAt(40, 40)]), { customTags: 'de' });

      const res = await matching(en.id).expect(200);

      expect(idsOf(res)).toEqual([en.id]);
      expect(res.body.skipped).toEqual([]);
      expect(Object.keys(res.body.variations[0]).sort()).toEqual(TEST_RUN_DTO_KEYS);
    });

    it('groups locales with the same change and explains every skipped sibling', async () => {
      const runs = await haveLocalesBuild();
      await enableBulkApprove();

      const res = await matching(runs.en.id).expect(200);

      expect(idsOf(res)).toEqual([runs.en.id, runs.de.id]);
      expect(skippedOf(res)).toEqual([
        ['es', 'different change size'],
        ['fr', 'different change pattern'],
        ['pt', 'no diff to match'],
      ]);
      expect(Object.keys(res.body.skipped[0]).sort()).toEqual([...TEST_RUN_DTO_KEYS, 'reason'].sort());
      const statuses = await prisma.testRun.findMany({ where: { buildId: runs.build.id }, select: { status: true } });
      expect(statuses.filter((run) => run.status === TestStatus.approved)).toHaveLength(0);
    }, 60000);

    it('falls back to computing signatures when none (or no usable one) is stored', async () => {
      const runs = await haveLocalesBuild();
      await enableBulkApprove();
      const stampedWithOtherThreshold = JSON.stringify({
        threshold: 0.5,
        includeAA: true,
        signature: Array(64).fill(1),
      });
      const wrongShape = JSON.stringify({ threshold: 0.1, includeAA: true, signature: [1, 2] });
      await prisma.testRun.update({ where: { id: runs.en.id }, data: { changeSignature: wrongShape } });
      await prisma.testRun.update({ where: { id: runs.de.id }, data: { changeSignature: 'not json' } });
      await prisma.testRun.update({ where: { id: runs.fr.id }, data: { changeSignature: stampedWithOtherThreshold } });

      const first = await matching(runs.en.id).expect(200);
      const second = await matching(runs.en.id).expect(200);

      for (const res of [first, second]) {
        expect(idsOf(res)).toEqual([runs.en.id, runs.de.id]);
        expect(skippedOf(res)).toEqual([
          ['es', 'different change size'],
          ['fr', 'different change pattern'],
          ['pt', 'no diff to match'],
        ]);
      }
    }, 60000);

    it('a sibling whose images cannot be read is skipped as having no diff', async () => {
      const runs = await haveLocalesBuild();
      await enableBulkApprove();
      await prisma.testRun.update({
        where: { id: runs.de.id },
        data: { changeSignature: null, baselineName: 'missing.baseline.png' },
      });

      const res = await matching(runs.en.id).expect(200);

      expect(idsOf(res)).toEqual([runs.en.id]);
      expect(skippedOf(res)).toEqual([
        ['de', 'no diff to match'],
        ['es', 'different change size'],
        ['fr', 'different change pattern'],
        ['pt', 'no diff to match'],
      ]);
    }, 60000);

    it('a reviewed run without a diff sends every sibling to manual review', async () => {
      const runs = await haveLocalesBuild();
      await enableBulkApprove();

      const res = await matching(runs.pt.id).expect(200);

      expect(idsOf(res)).toEqual([runs.pt.id]);
      expect(skippedOf(res)).toEqual([
        ['de', 'no reference diff'],
        ['en', 'no reference diff'],
        ['es', 'no reference diff'],
        ['fr', 'no reference diff'],
      ]);
    }, 60000);

    it('groups along the configured axis (os) instead of customTags', async () => {
      const build = await newBuild();
      const mac = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5)]), { os: 'mac' });
      const win = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(30, 30)]), { os: 'win' });
      await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5)]), { os: 'mac', customTags: 'de' });
      await enableBulkApprove('os');

      const res = await matching(mac.id).expect(200);

      expect(idsOf(res)).toEqual([mac.id, win.id]);
      expect(res.body.skipped).toEqual([]);
    }, 60000);

    it('an unknown group-by axis falls back to customTags', async () => {
      const build = await newBuild();
      const en = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5)]), { customTags: 'en' });
      const de = await runAgainstBaseline(build, WHITE, pngBuffer([redAt(30, 30)]), { customTags: 'de' });
      await runAgainstBaseline(build, WHITE, pngBuffer([redAt(5, 5)]), { customTags: 'en', os: 'mac' });
      await enableBulkApprove('bogus');

      const res = await matching(en.id).expect(200);

      expect(idsOf(res)).toEqual([en.id, de.id]);
    }, 60000);

    it('404 for an unknown id', async () => {
      await matching(randomUUID()).expect(404);
    });

    it('400 for an id that is not a uuid', async () => {
      await matching('abc').expect(400);
    });

    it('401 without a token', async () => {
      await requestWithAuth(app, 'get', `/test-runs/matchingSiblings/${randomUUID()}`, '').expect(401);
    });
  });
});
