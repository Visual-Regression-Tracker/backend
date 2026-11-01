import { INestApplication } from '@nestjs/common';
import { Project } from '@prisma/client';
import { BuildsController } from '../src/builds/builds.controller';
import { CreateBuildDto } from '../src/builds/dto/build-create.dto';
import { BuildsService } from '../src/builds/builds.service';
import { ProjectsService } from '../src/projects/projects.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { UsersService } from '../src/users/users.service';
import { TEST_PROJECT } from '../src/_data_';
import { createE2eApp, haveProject } from './api-helpers';
import { haveTestRunCreated, haveUserLogged, requestWithApiKey, requestWithAuth, LoggedUser } from './preconditions';

describe('Builds (e2e)', () => {
  let app: INestApplication;
  let buildsService: BuildsService;
  let buildsController: BuildsController;
  let projectsService: ProjectsService;
  let usersService: UsersService;
  let testRunsService: TestRunsService;
  let user: LoggedUser;
  let project: Project;

  beforeAll(async () => {
    const created = await createE2eApp();
    app = created.app;
    buildsService = created.get(BuildsService);
    buildsController = created.get(BuildsController);
    usersService = created.get(UsersService);
    projectsService = created.get(ProjectsService);
    testRunsService = created.get(TestRunsService);
  });

  beforeEach(async () => {
    user = await haveUserLogged(usersService);
    project = await haveProject(projectsService, 'Builds E2E test');
  });

  afterEach(async () => {
    await buildsService.whenRetentionIdle();
    await projectsService.remove(project.id);
    await usersService.delete(user.id);
  });

  afterAll(async () => {
    await app.close();
  });

  const haveBuild = () => buildsController.create({ project: project.id, branchName: 'develop' });
  const haveRun = (merge: boolean) =>
    haveTestRunCreated(buildsService, testRunsService, project.id, project.mainBranchName, './test/image.png', merge);

  describe('POST /', () => {
    it.each([
      ['by id', { branchName: 'branchName' }, 'branchName', false],
      ['by null branchname', { branchName: null }, TEST_PROJECT.mainBranchName, false],
      ['with no branchname and no ciBuildId', {}, TEST_PROJECT.mainBranchName, false],
      ['by name', { branchName: 'branchName' }, 'branchName', true],
      ['by ciBuildId', { ciBuildId: 'ciBuildId', branchName: 'branchName' }, 'branchName', true],
    ])('201 %s', async (_name, dto, branchName, byName) => {
      const createBuildDto = { ...dto, project: byName ? project.name : project.id } as CreateBuildDto;
      const existing = createBuildDto.ciBuildId ? await buildsController.create(createBuildDto) : undefined;

      await requestWithApiKey(app, 'post', '/builds', user.apiKey)
        .send(createBuildDto)
        .expect(201)
        .expect((res) => {
          expect(res.body).toMatchObject({
            projectId: project.id,
            branchName,
            failedCount: 0,
            passedCount: 0,
            unresolvedCount: 0,
            isRunning: true,
          });
          if (existing) {
            expect(res.body.id).toBe(existing.id);
            expect(res.body.ciBuildId).toBe(createBuildDto.ciBuildId);
          }
        });
    });

    it('201 cuncurrent', async () => {
      const createBuildDto: CreateBuildDto = {
        ciBuildId: 'ciBuildId',
        branchName: 'branchName',
        project: project.name,
      };
      await haveRun(false);
      await haveRun(false);

      const builds = await Promise.all(Array.from({ length: 5 }, () => buildsController.create(createBuildDto)));

      expect(new Set(builds.map((build) => build.id)).size).toBe(1);
    });

    it('parallel creates of one new ciBuildId number it once', async () => {
      const dto: CreateBuildDto = { ciBuildId: 'fresh', project: project.name };

      const builds = await Promise.all(Array.from({ length: 8 }, () => buildsController.create(dto)));

      expect(new Set(builds.map((build) => build.number))).toEqual(new Set([1]));
      expect((await projectsService.findOne(project.id)).buildsCounter).toBe(1);
    });

    it('404', () => {
      return requestWithApiKey(app, 'post', '/builds', user.apiKey)
        .send({ branchName: 'branchName', project: 'random' })
        .expect(404);
    });

    it('403', () => {
      return requestWithApiKey(app, 'post', '/builds', '')
        .send({ branchName: 'branchName', project: project.id })
        .expect(403);
    });
  });

  describe('GET /', () => {
    it('200', async () => {
      const build = await haveBuild();

      return requestWithAuth(app, 'get', `/builds?projectId=${project.id}&take=${5}&skip=${0}`, user.token)
        .send()
        .expect(200)
        .expect((res) => {
          expect(JSON.stringify(res.body)).toEqual(JSON.stringify({ data: [build], total: 1, take: 5, skip: 0 }));
        });
    });

    it('401', async () => {
      return requestWithAuth(app, 'get', `/builds?projectId=${project.id}&take=${5}&skip=${0}`, '').send().expect(401);
    });
  });

  describe('GET /:id', () => {
    it('200', async () => {
      const build = await haveBuild();

      return requestWithAuth(app, 'get', `/builds/${build.id}`, user.token)
        .send()
        .expect(200)
        .expect((res) => {
          expect(JSON.stringify(res.body)).toEqual(JSON.stringify(build));
        });
    });
  });

  describe('DELETE /', () => {
    it('401', async () => {
      const build = await haveBuild();

      return requestWithAuth(app, 'delete', `/builds/${build.id}`, '').send().expect(401);
    });
  });

  describe('PATCH /', () => {
    it('200 jwt', async () => {
      const build = await haveBuild();

      const res = await requestWithAuth(app, 'patch', `/builds/${build.id}`, user.token)
        .send({ isRunning: false })
        .expect(200);

      expect(res.body.isRunning).toBe(false);
    });

    it.each([
      ['without body', undefined],
      ['with empty body', {}],
    ])('200 api %s stops build', async (_name, body) => {
      const build = await haveBuild();

      const res = await requestWithApiKey(app, 'patch', `/builds/${build.id}`, user.apiKey).send(body).expect(200);

      expect(res.body.isRunning).toBe(false);
    });

    it('403', async () => {
      const build = await haveBuild();

      return requestWithAuth(app, 'patch', `/builds/${build.id}`, '').send().expect(403);
    });
  });

  describe('PATCH /:id/approve', () => {
    it.each([
      ['default', false],
      ['with merge', true],
    ])('200 %s', async (_name, merge) => {
      const { build } = await haveRun(merge);

      await buildsService.approve(build.id, merge);

      expect(await buildsService.findOne(build.id)).toEqual({
        ...build,
        status: 'passed',
        passedCount: 1,
        failedCount: 0,
        unresolvedCount: 0,
        merge,
      });
    });
  });
});
