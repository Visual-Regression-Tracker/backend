import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { haveTestRunCreated, haveUserLogged, requestWithApiKey, requestWithAuth } from './preconditions';
import { UserLoginResponseDto } from '../src/users/dto/user-login-response.dto';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { ProjectsService } from '../src/projects/projects.service';
import { Project, TestStatus } from '@prisma/client';
import { BuildsService } from '../src/builds/builds.service';
import { TestVariationsService } from '../src/test-variations/test-variations.service';
import { TEST_PROJECT } from '../src/_data_';
import uuidAPIKey from 'uuid-apikey';
import { UpdateIgnoreAreasDto } from 'src/test-runs/dto/update-ignore-area.dto';

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
  const image_v3 = './test/image_edited_2.png';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    testRunsService = moduleFixture.get<TestRunsService>(TestRunsService);
    usersService = moduleFixture.get<UsersService>(UsersService);
    projecstService = moduleFixture.get<ProjectsService>(ProjectsService);
    buildsService = moduleFixture.get<BuildsService>(BuildsService);
    testVariationsService = moduleFixture.get<TestVariationsService>(TestVariationsService);

    await app.init();
  });

  beforeEach(async () => {
    user = await haveUserLogged(usersService);
    project = await projecstService.create({
      ...TEST_PROJECT,
      name: `TestRun E2E test${uuidAPIKey.create().uuid}`,
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
      const { testRun: testRun2 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v2
      );
      await testRunsService.approve(testRun2.id);
      const { testRun: testRun3 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'feature',
        image_v2
      );
      await testRunsService.approve(testRun3.id);

      const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'develop', image_v3);

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
      await projecstService.update({ ...project, autoApproveFeature: true });
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
      await projecstService.update({ ...project, autoApproveFeature: true });
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
      await projecstService.update({ ...project, autoApproveFeature: true });
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

  describe('POST /multipart', () => {
    const url = '/test-runs/multipart';

    it('should post multipart all fields', async () => {
      const build = await buildsService.findOrCreate({ projectId: project.id, branchName: project.mainBranchName });

      await requestWithApiKey(app, 'post', url, user.apiKey)
        .set('Content-type', 'multipart/form-data')
        .field('name', 'Multipart image')
        .field('os', 'Windows')
        .field('browser', 'Browser')
        .field('viewport', '123x456')
        .field('device', 'Desktop')
        .field('branchName', project.mainBranchName)
        .field('buildId', build.id)
        .field('projectId', project.id)
        .field('diffTollerancePercent', '0.12')
        .field('merge', 'true')
        .field('ignoreAreas', '[{"id":"1692476944110","x":182,"y":28,"width":38,"height":30}]')
        .field('comment', 'Comment')
        .attach('image', image_v1)
        .expect(201);
    });

    it('should post multipart required fields', async () => {
      const build = await buildsService.findOrCreate({ projectId: project.id, branchName: project.mainBranchName });

      await requestWithApiKey(app, 'post', url, user.apiKey)
        .set('Content-type', 'multipart/form-data')
        .field('name', 'Multipart image')
        .field('branchName', project.mainBranchName)
        .field('buildId', build.id)
        .field('projectId', project.id)
        .attach('image', image_v1)
        .expect(201);
    });
  });

  describe('POST /approve', () => {
    it('approve changes in new main branch', async () => {
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

    it('approve changes in new feature branch', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v1
      );

      const result = await testRunsService.approve(testRun1.id);

      expect(result.status).toBe(TestStatus.approved);
      const testVariation = await testVariationsService.getDetails(result.testVariationId);
      expect(testVariation.baselines).toHaveLength(1);
      expect(testVariation.branchName).toBe('develop');
    });

    it('approve changes in main vs feature branch', async () => {
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

      const featureBranchResult = await testRunsService.approve(testRun2.id);

      expect(featureBranchResult.status).toBe(TestStatus.approved);
      const testVariation = await testVariationsService.getDetails(featureBranchResult.testVariationId);
      expect(testVariation.baselines).toHaveLength(1);
      expect(testVariation.branchName).toBe('develop');
    });

    it('approve changes in updated main vs feature branch', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
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
      const { testRun: testRun3 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v1
      );

      const result = await testRunsService.approve(testRun3.id);

      expect(result.status).toBe(TestStatus.approved);
      expect(result.baselineBranchName).toBe(project.mainBranchName);
      const testVariation = await testVariationsService.getDetails(result.testVariationId);
      expect(testVariation.branchName).toBe('develop');
      expect(testVariation.baselines).toHaveLength(2);
    });

    it('approve changes with merge', async () => {
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

  describe('POST /delete', () => {
    it('Should delete', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v1
      );
      const { testRun: testRun2 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v1
      );

      await requestWithAuth(app, 'post', `/test-runs/delete`, user.token).send([testRun1.id, testRun2.id]).expect(201);
    });
  });

  describe('POST /reject', () => {
    it('200', async () => {
      const { testRun: testRun1 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v1
      );
      const { testRun: testRun2 } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'develop',
        image_v1
      );

      await requestWithAuth(app, 'post', `/test-runs/reject`, user.token).send([testRun1.id, testRun2.id]).expect(201);
    });
  });

  describe('POST /ignoreAreas/update', () => {
    it('200', async () => {
      const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'develop', image_v1);

      const request: UpdateIgnoreAreasDto = {
        ids: [testRun.id],
        ignoreAreas: [
          {
            x: 182,
            y: 28,
            width: 38,
            height: 30,
          },
        ],
      };
      await requestWithAuth(app, 'post', `/test-runs/ignoreAreas/update`, user.token).send(request).expect(201);
    });
  });

  describe('POST /ignoreAreas/add', () => {
    it('200', async () => {
      const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'develop', image_v1);

      const request: UpdateIgnoreAreasDto = {
        ids: [testRun.id],
        ignoreAreas: [
          {
            x: 182,
            y: 28,
            width: 38,
            height: 30,
          },
        ],
      };
      await requestWithAuth(app, 'post', `/test-runs/ignoreAreas/add`, user.token).send(request).expect(201);
    });
  });
});
