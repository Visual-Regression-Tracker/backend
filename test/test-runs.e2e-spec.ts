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
import { PrismaService } from '../src/prisma/prisma.service';
import { TestVariationsService } from '../src/test-variations/test-variations.service';

jest.useFakeTimers();

describe('TestRuns (e2e)', () => {
  let app: INestApplication;
  let testRunsService: TestRunsService;
  let usersService: UsersService;
  let projecstService: ProjectsService;
  let buildsService: BuildsService;
  let testVariationsService: TestVariationsService;
  let user: UserLoginResponseDto;
  let project: Project;

  const image_v1 = './test/image.png';
  const image_v2 = './test/image_edited.png';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    testRunsService = moduleFixture.get<TestRunsService>(TestRunsService);
    usersService = moduleFixture.get<UsersService>(UsersService);
    projecstService = moduleFixture.get<ProjectsService>(ProjectsService);
    buildsService = moduleFixture.get<BuildsService>(BuildsService);
    testVariationsService = moduleFixture.get<TestVariationsService>(TestVariationsService);

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
      await testRunsService.approve(testRun1.id);

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
      await testRunsService.approve(testRun1.id);

      const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'develop', image_v1);

      expect(testRun.status).toBe(TestStatus.ok);
    });

    it('Auto approve not rebased feature branch then Ok after rebase', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v1
      );
      await testRunsService.approve(testRun1.id);
      const { testRun: testRun2 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v2
      );
      await testRunsService.approve(testRun2.id);

      const { testRun: notRebasedTestRun } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v1
      );
      expect(notRebasedTestRun.status).toBe(TestStatus.autoApproved);

      const { testRun: rebasedTestRun } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v2
      );

      expect(rebasedTestRun.status).toBe(TestStatus.ok);
    });

    it('Auto approve merged feature into feature branch', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'feature1',
        image_v1
      );
      await testRunsService.approve(testRun1.id);

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
      await testRunsService.approve(testRun1.id);
      const { testRun: testRun2 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v2
      );
      await testRunsService.approve(testRun2.id);

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

  describe('POST /approve', () => {
    it('approve changes in existing testVariation', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v1
      );

      const result = await testRunsService.approve(testRun1.id);

      expect(result.status).toBe(TestStatus.approved);
      const testVariation = await testVariationsService.getDetails(result.testVariationId);
      expect(testVariation.baselines).toHaveLength(1);
    });

    it('approve changes in existing testVariation with merge', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v1
      );
      const mainBranchResult = await testRunsService.approve(testRun1.id);
      const { testRun: testRun2 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v2,
        true
      );

      const featureBranchResult = await testRunsService.approve(testRun2.id, true);

      expect(featureBranchResult.status).toBe(TestStatus.approved);
      expect(featureBranchResult.merge).toBe(true);
      const mainBranchTestVariation = await testVariationsService.getDetails(mainBranchResult.testVariationId);
      expect(mainBranchTestVariation.baselines).toHaveLength(2);
      expect(mainBranchTestVariation.baselines.shift().baselineName).toBe(mainBranchTestVariation.baselineName);
    });

    it('approve feature branch testVariation', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v1
      );
      const mainBranchResult = await testRunsService.approve(testRun1.id);
      const { testRun: testRun2 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v2
      );

      const featureBranchResult = await testRunsService.approve(testRun2.id);

      expect(featureBranchResult.status).toBe(TestStatus.approved);
      const mainBranchTestVariation = await testVariationsService.getDetails(mainBranchResult.testVariationId);
      expect(mainBranchTestVariation.baselines).toHaveLength(1);
    });

    it('autoApprove feature branch testVariation', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v1
      );
      const mainBranchResult = await testRunsService.approve(testRun1.id);
      const { testRun: testRun2 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v2
      );

      const featureBranchResult = await testRunsService.approve(testRun2.id, false, true);

      expect(featureBranchResult.status).toBe(TestStatus.autoApproved);
      expect(mainBranchResult.testVariationId).toBe(featureBranchResult.testVariationId);
    });
  });
});
