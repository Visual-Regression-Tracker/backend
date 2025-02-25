import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { haveTestRunCreated, haveUserLogged } from './preconditions';
import { UserLoginResponseDto } from '../src/users/dto/user-login-response.dto';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { ProjectsService } from '../src/projects/projects.service';
import { Project } from '@prisma/client';
import { BuildsService } from '../src/builds/builds.service';
import { TestVariationsService } from '../src/test-variations/test-variations.service';
import { TEST_PROJECT } from '../src/_data_';
import uuidAPIKey from 'uuid-apikey';

describe('TestVariations (e2e)', () => {
  let app: INestApplication;
  let testRunsService: TestRunsService;
  let usersService: UsersService;
  let projecstService: ProjectsService;
  let buildsService: BuildsService;
  let user: UserLoginResponseDto;
  let project: Project;
  let testVariationsService: TestVariationsService;

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
      name: `TestVariations E2E test${uuidAPIKey.create().uuid}`,
    });
  });

  afterEach(async () => {
    await projecstService.remove(project.id);
    await usersService.delete(user.id);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('DELETE /', () => {
    const image_v1 = './test/image.png';

    it('can delete', async () => {
      const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'develop', image_v1);
      await testRunsService.approve(testRun.id);

      await testVariationsService.delete(testRun.testVariationId);

      expect((await testRunsService.findOne(testRun.id)).testVariationId).toBeNull();
    });
  });

  describe('find old test variations', () => {
    it('filters out test runs matching releaseBranch and mainBranchName', async () => {
      const baselineBranchName = 'release-1';
      const image_v1 = './test/image.png';
      const image_v2 = './test/image_edited.png';

      // Add variation to main branch
      const { testRun: mainBranchTestRun } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        project.mainBranchName,
        image_v1
      );
      await testRunsService.approve(mainBranchTestRun.id);

      // Add variation to release branch
      const { testRun: releaseBranchTestRun } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        baselineBranchName,
        image_v1,
        false,
        baselineBranchName
      );
      await testRunsService.approve(releaseBranchTestRun.id);

      // Add variation to feature branch
      const { testRun: featureBranchTestRun } = await haveTestRunCreated(
        buildsService,
        testRunsService,
        project.id,
        'feature',
        image_v2,
        false,
        project.mainBranchName
      );
      const featureBranchTestRunApproved = await testRunsService.approve(featureBranchTestRun.id);

      const result = await testVariationsService.findOldTestVariations(project, new Date());
      expect(result).toHaveLength(1);
      expect(result).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: featureBranchTestRunApproved.testVariationId })])
      );
    });
  });
});
