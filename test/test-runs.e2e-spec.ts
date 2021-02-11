import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { haveTestRunCreated, haveUserLogged } from './preconditions';
import { UserLoginResponseDto } from '../src/users/dto/user-login-response.dto';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { ProjectsService } from '../src/projects/projects.service';
import { Project, TestStatus } from '../prisma/node_modules/@prisma/client';
import { BuildsService } from '../src/builds/builds.service';
import { BuildDto } from '../src/builds/dto/build.dto';
import { TestVariationsService } from '../src/test-variations/test-variations.service';

jest.setTimeout(20000);

describe('TestRuns (e2e)', () => {
  let app: INestApplication;
  let testRunsService: TestRunsService;
  let usersService: UsersService;
  let projecstService: ProjectsService;
  let buildsService: BuildsService;
  let user: UserLoginResponseDto;
  let project: Project;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    testRunsService = moduleFixture.get<TestRunsService>(TestRunsService);
    usersService = moduleFixture.get<UsersService>(UsersService);
    projecstService = moduleFixture.get<ProjectsService>(ProjectsService);
    buildsService = moduleFixture.get<BuildsService>(BuildsService);

    await app.init();
  });

  beforeEach(async () => {
    user = await haveUserLogged(usersService);
    project = await projecstService.create({ name: 'TestRun E2E test', mainBranchName: 'master' });
  });

  afterEach(async () => {
    await projecstService.remove(project.id);
    await usersService.delete(user.id);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /', () => {
    const image_v1 = './test/image.png';
    const image_v2 = './test/image_edited.png';
    it('Auto approve feature branch based on history', async () => {
      const testRun1 = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v1
      );
      await testRunsService.approve(testRun1.id, false, false);
      const testRun2 = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v2
      );
      await testRunsService.approve(testRun2.id, false, false);

      const testRun = await haveTestRunCreated(buildsService, testRunsService, project.id, 'develop', image_v1);

      expect(testRun.status).toBe(TestStatus.autoApproved);
    });
  });
});
