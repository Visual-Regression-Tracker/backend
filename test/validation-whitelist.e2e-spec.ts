import { INestApplication } from '@nestjs/common';
import { Build, Project, TestStatus } from '@prisma/client';
import { BuildsService } from '../src/builds/builds.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';
import { UsersService } from '../src/users/users.service';
import { approveRuns, createE2eApp, haveProject, postRunBase64, WHITE } from './api-helpers';
import { haveUserLogged, LoggedUser, requestWithApiKey, requestWithAuth } from './preconditions';

describe('Global whitelist (e2e)', () => {
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
    project = await haveProject(projectsService, 'Whitelist E2E');
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

  const postRun = async (build: Build, extra: Record<string, unknown> = {}) =>
    postRunBase64(app, user, build, WHITE, extra);

  it('PATCH /test-runs/update/:id writes the comment and nothing else', async () => {
    const run = await postRun(await newBuild());
    await approveRuns(app, user, [run.id]);
    const before = (await prisma.testVariation.findUnique({ where: { id: run.testVariationId } }))!;

    await requestWithAuth(app, 'patch', `/test-runs/update/${run.id}`, user.token)
      .send({ comment: 'fine', baselineName: 'other.baseline.png' })
      .expect(200);

    const after = (await prisma.testVariation.findUnique({ where: { id: run.testVariationId } }))!;
    expect(after.comment).toBe('fine');
    expect(after.baselineName).toBe(before.baselineName);
  });

  it('POST /test-runs/ignoreAreas/update keeps the id of every area', async () => {
    const run = await postRun(await newBuild());
    const areas = [
      { id: 'a', x: 1, y: 2, width: 3, height: 4 },
      { id: 'b', x: 5, y: 6, width: 7, height: 8 },
    ];

    await requestWithAuth(app, 'post', '/test-runs/ignoreAreas/update', user.token)
      .send({ ids: [run.id], ignoreAreas: areas })
      .expect(201);

    const stored = (await prisma.testRun.findUnique({ where: { id: run.id }, include: { testVariation: true } }))!;
    expect(JSON.parse(stored.ignoreAreas)).toEqual(areas);
    expect(JSON.parse(stored.testVariation!.ignoreAreas)).toEqual(areas);
  });

  it('POST /test-runs/multipart keeps the image, the form values and the area ids', async () => {
    const build = await newBuild();

    await requestWithApiKey(app, 'post', '/test-runs/multipart', user.apiKey)
      .set('Content-type', 'multipart/form-data')
      .field('name', 'Multipart image')
      .field('branchName', project.mainBranchName)
      .field('buildId', build.id)
      .field('projectId', project.id)
      .field('merge', 'true')
      .field('ignoreAreas', '[{"id":"1692476944110","x":1,"y":2,"width":3,"height":4}]')
      .field('unknown', 'dropped')
      .attach('image', './test/image.png')
      .expect(201);

    const [testRun] = await prisma.testRun.findMany({ where: { buildId: build.id } });
    expect(testRun.merge).toBe(true);
    expect(JSON.parse(testRun.tempIgnoreAreas)).toEqual([{ id: '1692476944110', x: 1, y: 2, width: 3, height: 4 }]);
  });

  it('POST /test-runs compares against the sourceBranch variation', async () => {
    const release = await postRun(await newBuild('release'));
    await approveRuns(app, user, [release.id]);
    const feature = await newBuild('feature');

    const compared = await postRun(feature, { sourceBranch: 'release' });

    expect(compared.status).toBe(TestStatus.ok);
  });

  it('PATCH /builds/:id still answers 400 for fields it does not declare', async () => {
    const build = await newBuild();

    await requestWithApiKey(app, 'patch', `/builds/${build.id}`, user.apiKey)
      .send({ branchName: 'rewritten', number: 4242 })
      .expect(400);

    expect(await prisma.build.findUnique({ where: { id: build.id } })).toMatchObject({ isRunning: true });
  });
});
