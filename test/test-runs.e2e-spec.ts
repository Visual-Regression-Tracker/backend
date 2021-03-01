import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { haveTestRunCreated, haveUserLogged } from './preconditions';
import { UserLoginResponseDto } from '../src/users/dto/user-login-response.dto';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { ProjectsService } from '../src/projects/projects.service';
import { Project, TestStatus } from '@prisma/client';
import { BuildsService } from '../src/builds/builds.service';

jest.useFakeTimers();

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
    jest.runOnlyPendingTimers();
    await app.close();
  });

  describe('POST /', () => {
    const image_v1 = './test/image.png';
    const image_v2 = './test/image_edited.png';

    it('New if no baseline', async () => {
      const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'develop', image_v1);

      expect(testRun.status).toBe(TestStatus.new);
    });

    it('Unresolved if diff found', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v1
      );
      await testRunsService.approve(testRun1.id, false, false);

      const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'develop', image_v2);

      expect(testRun.status).toBe(TestStatus.unresolved);
    });

    it('Ok', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v1
      );
      await testRunsService.approve(testRun1.id, false, false);

      const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'develop', image_v1);

      expect(testRun.status).toBe(TestStatus.ok);
    });

    it('Auto approve not rebased feature branch', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v1
      );
      await testRunsService.approve(testRun1.id, false, false);
      const { testRun: testRun2 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v2
      );
      await testRunsService.approve(testRun2.id, false, false);

      const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'develop', image_v1);

      expect(testRun.status).toBe(TestStatus.autoApproved);
    });

    it('Auto approve merged feature into feature branch', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'feature1',
        image_v1
      );
      await testRunsService.approve(testRun1.id, false, false);

      const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'feature2', image_v1);

      expect(testRun.status).toBe(TestStatus.autoApproved);
    });

    it('Auto approve merged feature into main branch', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v1
      );
      await testRunsService.approve(testRun1.id, false, false);
      const { testRun: testRun2 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v2
      );
      await testRunsService.approve(testRun2.id, false, false);

      const { testRun } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v2
      );

      expect(testRun.status).toBe(TestStatus.autoApproved);
    });
  });
});
