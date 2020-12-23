import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { haveUserLogged, requestWithApiKey, requestWithAuth } from './preconditions';
import { BuildsService } from '../src/builds/builds.service';
import { CreateBuildDto } from '../src/builds/dto/build-create.dto';
import { UserLoginResponseDto } from '../src/users/dto/user-login-response.dto';
import { Project } from '@prisma/client';
import { ProjectsService } from '../src/projects/projects.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { readFileSync } from 'fs';

describe('Builds (e2e)', () => {
  let app: INestApplication;
  let buildsService: BuildsService;
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
    buildsService = moduleFixture.get<BuildsService>(BuildsService);
    usersService = moduleFixture.get<UsersService>(UsersService);
    projecstService = moduleFixture.get<ProjectsService>(ProjectsService);
    testRunsService = moduleFixture.get<TestRunsService>(TestRunsService);

    await app.init();
  });

  beforeEach(async () => {
    user = await haveUserLogged(usersService);
    project = await projecstService.create({ name: 'E2E test', mainBranchName: 'master' });
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
      return requestWithApiKey(app, 'post', '/builds', createBuildDto, user.apiKey)
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

    it('201 by name', () => {
      const createBuildDto: CreateBuildDto = {
        branchName: 'branchName',
        project: project.name,
      };
      return requestWithApiKey(app, 'post', '/builds', createBuildDto, user.apiKey)
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
      const build = await buildsService.create(createBuildDto);

      return requestWithApiKey(app, 'post', '/builds', createBuildDto, user.apiKey)
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

    it('404', () => {
      const createBuildDto: CreateBuildDto = {
        branchName: 'branchName',
        project: 'random',
      };
      return requestWithApiKey(app, 'post', '/builds', createBuildDto, user.apiKey).expect(404);
    });

    it('403', () => {
      const createBuildDto: CreateBuildDto = {
        branchName: 'branchName',
        project: project.id,
      };
      return requestWithApiKey(app, 'post', '/builds', createBuildDto, '').expect(403);
    });
  });

  describe('GET /', () => {
    it('200', async () => {
      const build = await buildsService.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'get', `/builds?projectId=${project.id}&take=${5}&skip=${0}`, {}, user.token)
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
      return requestWithAuth(app, 'get', `/builds?projectId=${project.id}&take=${5}&skip=${0}`, {}, '').expect(401);
    });
  });

  describe('GET /:id', () => {
    it('200', async () => {
      const build = await buildsService.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'get', `/builds/${build.id}`, {}, user.token)
        .expect(200)
        .expect((res) => {
          expect(JSON.stringify(res.body)).toEqual(JSON.stringify(build));
        });
    });
  });

  describe('DELETE /', () => {
    it('200', async () => {
      const build = await buildsService.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'delete', `/builds/${build.id}`, {}, user.token).expect(200);
    });

    it('401', async () => {
      const build = await buildsService.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'delete', `/builds/${build.id}`, {}, '').expect(401);
    });
  });

  describe('PATCH /', () => {
    it('200 jwt', async () => {
      const build = await buildsService.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'patch', `/builds/${build.id}`, {}, user.token)
        .expect(200)
        .expect((res) => {
          expect(res.body.isRunning).toBe(false);
        });
    });

    it('200 api', async () => {
      const build = await buildsService.create({ project: project.id, branchName: 'develop' });

      return requestWithApiKey(app, 'patch', `/builds/${build.id}`, {}, user.apiKey)
        .expect(200)
        .expect((res) => {
          expect(res.body.isRunning).toBe(false);
        });
    });

    it('403', async () => {
      const build = await buildsService.create({ project: project.id, branchName: 'develop' });

      return requestWithAuth(app, 'patch', `/builds/${build.id}`, {}, '').expect(403);
    });
  });

  describe('PATCH /:id/approve', () => {
    it('200', async () => {
      const build = await buildsService.create({ project: project.id, branchName: 'develop' });
      await testRunsService.postTestRun({
        projectId: build.projectId,
        branchName: build.branchName,
        imageBase64: readFileSync('./test/image.png').toString('base64'),
        buildId: build.id,
        name: 'Image name',
        merge: true,
      });

      return requestWithAuth(app, 'patch', `/builds/${build.id}/approve?merge=true`, {}, user.token)
        .expect(200)
        .expect((resp) => {
          expect(JSON.stringify(resp.body)).toBe(
            JSON.stringify({ ...build, status: 'passed', passedCount: 1, merge: true })
          );
        });
    });
  });
});
