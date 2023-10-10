import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { haveTestRunCreated, haveUserLogged, requestWithApiKey, requestWithAuth } from './preconditions';
import { BuildsService } from '../src/builds/builds.service';
import { CreateBuildDto } from '../src/builds/dto/build-create.dto';
import { UserLoginResponseDto } from '../src/users/dto/user-login-response.dto';
import { Project } from '@prisma/client';
import { ProjectsService } from '../src/projects/projects.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { BuildsController } from '../src/builds/builds.controller';
import { TEST_PROJECT } from '../src/_data_';
import uuidAPIKey from 'uuid-apikey';

describe('Builds (e2e)', () => {
  let app: INestApplication;
  let buildsService: BuildsService;
  let buildsController: BuildsController;
  let projecstService: ProjectsService;
  let usersService: UsersService;
  let testRunsService: TestRunsService;
  let user: UserLoginResponseDto;
  let project: Project;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    buildsService = moduleFixture.get<BuildsService>(BuildsService);
    buildsController = moduleFixture.get<BuildsController>(BuildsController);
    usersService = moduleFixture.get<UsersService>(UsersService);
    projecstService = moduleFixture.get<ProjectsService>(ProjectsService);
    testRunsService = moduleFixture.get<TestRunsService>(TestRunsService);

    await app.init();
  });

  beforeEach(async () => {
    user = await haveUserLogged(usersService);
    project = await projecstService.create({
      ...TEST_PROJECT,
      name: `Builds E2E test${uuidAPIKey.create().uuid}`,
    });
  });

  afterEach(async () => {
    await projecstService.remove(project.id);
    await usersService.delete(user.id);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /', () => {
    it('201 by id', () => {
      const createBuildDto: CreateBuildDto = {
        branchName: 'branchName',
        project: project.id,
      };
      return requestWithApiKey(app, 'post', '/builds', user.apiKey)
        .send(createBuildDto)
        .expect(201)
        .expect((res) => {
          expect(res.body.projectId).toBe(project.id);
          expect(res.body.branchName).toBe(createBuildDto.branchName);
          expect(res.body.failedCount).toBe(0);
          expect(res.body.passedCount).toBe(0);
          expect(res.body.unresolvedCount).toBe(0);
          expect(res.body.isRunning).toBe(true);
        });
    });

    it('201 by null branchname', () => {
      const createBuildDto: CreateBuildDto = {
        branchName: null,
        project: project.id,
      };
      return requestWithApiKey(app, 'post', '/builds', user.apiKey)
        .send(createBuildDto)
        .expect(201)
        .expect((res) => {
          expect(res.body.projectId).toBe(project.id);
          expect(res.body.branchName).toBe(TEST_PROJECT.mainBranchName);
          expect(res.body.failedCount).toBe(0);
          expect(res.body.passedCount).toBe(0);
          expect(res.body.unresolvedCount).toBe(0);
          expect(res.body.isRunning).toBe(true);
        });
    });

    it('201 with no branchname and no ciBuildId', () => {
      const createBuildDto: CreateBuildDto = {
        project: project.id,
      };
      return requestWithApiKey(app, 'post', '/builds', user.apiKey)
        .send(createBuildDto)
        .expect(201)
        .expect((res) => {
          expect(res.body.projectId).toBe(project.id);
          expect(res.body.branchName).toBe(TEST_PROJECT.mainBranchName);
          expect(res.body.failedCount).toBe(0);
          expect(res.body.passedCount).toBe(0);
          expect(res.body.unresolvedCount).toBe(0);
          expect(res.body.isRunning).toBe(true);
        });
    });

    it('201 by name', () => {
      const createBuildDto: CreateBuildDto = {
        branchName: 'branchName',
        project: project.name,
      };
      return requestWithApiKey(app, 'post', '/builds', user.apiKey)
        .send(createBuildDto)
        .expect(201)
        .expect((res) => {
          expect(res.body.projectId).toBe(project.id);
          expect(res.body.branchName).toBe(createBuildDto.branchName);
          expect(res.body.failedCount).toBe(0);
          expect(res.body.passedCount).toBe(0);
          expect(res.body.unresolvedCount).toBe(0);
          expect(res.body.isRunning).toBe(true);
        });
    });

    it('201 by ciBuildId', async () => {
      const createBuildDto: CreateBuildDto = {
        ciBuildId: 'ciBuildId',
        branchName: 'branchName',
        project: project.name,
      };
      const build = await buildsController.create(createBuildDto);

      return requestWithApiKey(app, 'post', '/builds', user.apiKey)
        .send(createBuildDto)
        .expect(201)
        .expect((res) => {
          expect(res.body.id).toBe(build.id);
          expect(res.body.ciBuildId).toBe(createBuildDto.ciBuildId);
          expect(res.body.projectId).toBe(project.id);
          expect(res.body.branchName).toBe(createBuildDto.branchName);
          expect(res.body.failedCount).toBe(0);
          expect(res.body.passedCount).toBe(0);
          expect(res.body.unresolvedCount).toBe(0);
          expect(res.body.isRunning).toBe(true);
        });
    });

    it('201 cuncurrent', async () => {
      const createBuildDto: CreateBuildDto = {
        ciBuildId: 'ciBuildId',
        branchName: 'branchName',
        project: project.name,
      };

      const builds = await Promise.all([
        buildsController.create(createBuildDto),
        buildsController.create(createBuildDto),
        buildsController.create(createBuildDto),
        buildsController.create(createBuildDto),
        buildsController.create(createBuildDto),
      ]);

      expect(new Set(builds.map((build) => build.id)).size).toBe(1);
    });

    it('404', () => {
      const createBuildDto: CreateBuildDto = {
        branchName: 'branchName',
        project: 'random',
      };
      return requestWithApiKey(app, 'post', '/builds', user.apiKey).send(createBuildDto).expect(404);
    });

    it('403', () => {
      const createBuildDto: CreateBuildDto = {
        branchName: 'branchName',
        project: project.id,
      };
      return requestWithApiKey(app, 'post', '/builds', '').send(createBuildDto).expect(403);
    });
  });

  describe('GET /', () => {
    it('200', async () => {
      const build = await buildsController.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'get', `/builds?projectId=${project.id}&take=${5}&skip=${0}`, user.token)
        .send()
        .expect(200)
        .expect((res) => {
          expect(JSON.stringify(res.body)).toEqual(
            JSON.stringify({
              data: [build],
              total: 1,
              take: 5,
              skip: 0,
            })
          );
        });
    });

    it('401', async () => {
      return requestWithAuth(app, 'get', `/builds?projectId=${project.id}&take=${5}&skip=${0}`, '').send().expect(401);
    });
  });

  describe('GET /:id', () => {
    it('200', async () => {
      const build = await buildsController.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'get', `/builds/${build.id}`, user.token)
        .send()
        .expect(200)
        .expect((res) => {
          expect(JSON.stringify(res.body)).toEqual(JSON.stringify(build));
        });
    });
  });

  describe('DELETE /', () => {
    it('200', async () => {
      const build = await buildsController.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'delete', `/builds/${build.id}`, user.token).send().expect(200);
    });

    it('401', async () => {
      const build = await buildsController.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'delete', `/builds/${build.id}`, '').send().expect(401);
    });
  });

  describe('PATCH /', () => {
    it('200 jwt', async () => {
      const build = await buildsController.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'patch', `/builds/${build.id}`, user.token)
        .send()
        .expect(200)
        .expect((res) => {
          expect(res.body.isRunning).toBe(false);
        });
    });

    it('200 api', async () => {
      const build = await buildsController.create({ project: project.id, branchName: 'develop' });

      return requestWithApiKey(app, 'patch', `/builds/${build.id}`, user.apiKey)
        .send()
        .expect(200)
        .expect((res) => {
          expect(res.body.isRunning).toBe(false);
        });
    });

    it('403', async () => {
      const build = await buildsController.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'patch', `/builds/${build.id}`, '').send().expect(403);
    });
  });

  describe('PATCH /:id/approve', () => {
    it('200 default', async () => {
      const { build } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        './test/image.png',
        false
      );

      await buildsService.approve(build.id, false);

      const result = await buildsService.findOne(build.id);
      expect(result).toEqual({
        ...build,
        status: 'passed',
        passedCount: 1,
        failedCount: 0,
        unresolvedCount: 0,
        merge: false,
      });
    });

    it('200 with merge', async () => {
      const { build } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        './test/image.png',
        true
      );

      await buildsService.approve(build.id, true);

      const result = await buildsService.findOne(build.id);
      expect(result).toEqual({
        ...build,
        status: 'passed',
        passedCount: 1,
        failedCount: 0,
        unresolvedCount: 0,
        merge: true,
      });
    });
  });
});
