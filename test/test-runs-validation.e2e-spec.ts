import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PNG } from 'pngjs';
import { Build, Project } from '@prisma/client';
import { UsersService } from '../src/users/users.service';
import { ProjectsService } from '../src/projects/projects.service';
import { BuildsService } from '../src/builds/builds.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { createE2eApp, haveProject, withEnv } from './api-helpers';
import { haveUserLogged, LoggedUser, requestWithApiKey, requestWithAuth } from './preconditions';

describe('Test runs input validation (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let projectsService: ProjectsService;
  let buildsService: BuildsService;
  let testRunsService: TestRunsService;
  let user: LoggedUser;
  let project: Project;
  let build: Build;

  const image = './test/image.png';

  beforeAll(async () => {
    const created = await createE2eApp();
    app = created.app;
    usersService = created.get(UsersService);
    projectsService = created.get(ProjectsService);
    buildsService = created.get(BuildsService);
    testRunsService = created.get(TestRunsService);
  });

  beforeEach(async () => {
    user = await haveUserLogged(usersService);
    project = await haveProject(projectsService, 'Validation E2E');
    build = await buildsService.findOrCreate({ projectId: project.id, branchName: project.mainBranchName });
  });

  afterEach(async () => {
    await projectsService.remove(project.id);
    await usersService.delete(user.id);
  });

  afterAll(async () => {
    await app.close();
  });

  const multipart = () =>
    requestWithApiKey(app, 'post', '/test-runs/multipart', user.apiKey)
      .set('Content-type', 'multipart/form-data')
      .field('name', 'Multipart image')
      .field('branchName', project.mainBranchName)
      .field('buildId', build.id)
      .field('projectId', project.id);

  const postBase64 = (imageBase64: string) =>
    requestWithApiKey(app, 'post', '/test-runs', user.apiKey).send({
      name: 'Base64 image',
      branchName: project.mainBranchName,
      buildId: build.id,
      projectId: project.id,
      imageBase64,
    });

  it('keeps every multipart field, the area id included', async () => {
    await multipart()
      .field('diffTollerancePercent', '0.12')
      .field('merge', 'true')
      .field('ignoreAreas', '[{"id":"1692476944110","x":182.5,"y":28,"width":38,"height":30}]')
      .attach('image', image)
      .expect(201);

    const [testRun] = await testRunsService.findMany(build.id);
    expect(testRun.merge).toBe(true);
    expect(testRun.diffTollerancePercent).toBe(0.12);
    expect(JSON.parse(testRun.tempIgnoreAreas)).toEqual([
      { id: '1692476944110', x: 182.5, y: 28, width: 38, height: 30 },
    ]);
  });

  it('400 for a multipart request without the image, storing nothing', async () => {
    await multipart().expect(400);

    expect(await testRunsService.findMany(build.id)).toEqual([]);
  });

  it('400 for multipart ignore areas that are not JSON', async () => {
    await multipart().field('ignoreAreas', 'not-json').attach('image', image).expect(400);

    expect(await testRunsService.findMany(build.id)).toEqual([]);
  });

  it('413 for a file over the multipart limit', async () => {
    await withEnv({ MULTIPART_FILE_SIZE_LIMIT: '1000' }, () => multipart().attach('image', image).expect(413));
  });

  it('400 for a base64 image that is not a PNG', async () => {
    const res = await postBase64(Buffer.from('GIF89a').toString('base64')).expect(400);

    expect(res.body.message).toBe('Image is not a PNG file');
    expect(await testRunsService.findMany(build.id)).toEqual([]);
  });

  it('accepts a base64 image with line breaks', async () => {
    const imageBase64 = PNG.sync
      .write(new PNG({ width: 40, height: 40 }))
      .toString('base64')
      .replace(/(.{76})/g, '$1\r\n');

    await postBase64(imageBase64).expect(201);
  });

  it.each(['approve?merge=false', 'reject', 'delete'])('400 for a %s body that is not an array', async (path) => {
    await requestWithAuth(app, 'post', `/test-runs/${path}`, user.token)
      .send({ ids: [randomUUID()] })
      .expect(400);
  });

  it('400 for ignore areas that are an object', async () => {
    await requestWithAuth(app, 'post', '/test-runs/ignoreAreas/update', user.token)
      .send({ ids: [randomUUID()], ignoreAreas: { x: 1, y: 2, width: 3, height: 4 } })
      .expect(400);
  });
});
