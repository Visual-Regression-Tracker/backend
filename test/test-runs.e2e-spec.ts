import { INestApplication } from '@nestjs/common';
import { Project, TestStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { BuildsService } from '../src/builds/builds.service';
import { ProjectsService } from '../src/projects/projects.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { TestVariationsService } from '../src/test-variations/test-variations.service';
import { UsersService } from '../src/users/users.service';
import { createE2eApp, haveProject } from './api-helpers';
import { haveTestRunCreated, haveUserLogged, requestWithApiKey, LoggedUser } from './preconditions';

describe('TestRuns (e2e)', () => {
  let app: INestApplication;
  let testRunsService: TestRunsService;
  let usersService: UsersService;
  let projectsService: ProjectsService;
  let buildsService: BuildsService;
  let testVariationsService: TestVariationsService;
  let user: LoggedUser;
  let project: Project;

  const image_v1 = './test/image.png';
  const image_v2 = './test/image_edited.png';
  const image_v3 = './test/image_edited_2.png';

  beforeAll(async () => {
    const created = await createE2eApp();
    app = created.app;
    testRunsService = created.get(TestRunsService);
    usersService = created.get(UsersService);
    projectsService = created.get(ProjectsService);
    buildsService = created.get(BuildsService);
    testVariationsService = created.get(TestVariationsService);
  });

  beforeEach(async () => {
    user = await haveUserLogged(usersService);
    project = await haveProject(projectsService, 'TestRun E2E test');
  });

  afterEach(async () => {
    await projectsService.remove(project.id);
    await usersService.delete(user.id);
  });

  afterAll(async () => {
    await app.close();
  });

  const haveRun = async (branchName: string, image: string, merge?: boolean) =>
    (await haveTestRunCreated(buildsService, testRunsService, project.id, branchName, image, merge)).testRun;
  const haveApprovedRun = async (branchName: string, image: string) => {
    const testRun = await haveRun(branchName, image);
    await testRunsService.approve(testRun.id);
    return testRun;
  };
  const detailsOf = async (testVariationId: string | null) => testVariationsService.getDetails(testVariationId!);

  describe('POST /', () => {
    it('New if no baseline', async () => {
      const testRun = await haveRun('develop', image_v1);

      expect(testRun.status).toBe(TestStatus.new);
    });

    it('Unresolved if diff found', async () => {
      await haveApprovedRun(project.mainBranchName, image_v1);
      await haveApprovedRun(project.mainBranchName, image_v2);
      await haveApprovedRun('feature', image_v2);

      const testRun = await haveRun('develop', image_v3);

      expect(testRun.status).toBe(TestStatus.unresolved);
    });

    it('Ok', async () => {
      await haveApprovedRun(project.mainBranchName, image_v1);

      const testRun = await haveRun('develop', image_v1);

      expect(testRun.status).toBe(TestStatus.ok);
    });

    it('Auto approve not rebased feature branch then Ok after rebase', async () => {
      await projectsService.update({ ...project, autoApproveFeature: true });
      await haveApprovedRun(project.mainBranchName, image_v1);
      await haveApprovedRun(project.mainBranchName, image_v2);

      const notRebasedTestRun = await haveRun('develop', image_v1);
      expect(notRebasedTestRun.status).toBe(TestStatus.autoApproved);

      const rebasedTestRun = await haveRun('develop', image_v2);

      expect(rebasedTestRun.status).toBe(TestStatus.ok);
    });

    it('Auto approve merged feature into feature branch', async () => {
      await projectsService.update({ ...project, autoApproveFeature: true });
      await haveApprovedRun('feature1', image_v1);

      const testRun = await haveRun('feature2', image_v1);

      expect(testRun.status).toBe(TestStatus.autoApproved);
    });

    it('Auto approve merged feature into main branch', async () => {
      await projectsService.update({ ...project, autoApproveFeature: true });
      await haveApprovedRun(project.mainBranchName, image_v1);
      await haveApprovedRun('develop', image_v2);

      const testRun = await haveRun(project.mainBranchName, image_v2);

      expect(testRun.status).toBe(TestStatus.autoApproved);
    });
  });

  describe('POST /multipart', () => {
    const post = async (projectId = project.id) => {
      const build = await buildsService.findOrCreate({ projectId: project.id, branchName: project.mainBranchName });
      return {
        build,
        req: requestWithApiKey(app, 'post', '/test-runs/multipart', user.apiKey)
          .set('Content-type', 'multipart/form-data')
          .field('name', 'Multipart image')
          .field('branchName', project.mainBranchName)
          .field('buildId', build.id)
          .field('projectId', projectId)
          .attach('image', image_v1),
      };
    };

    it('should post multipart all fields', async () => {
      const { req } = await post();

      await req
        .field('os', 'Windows')
        .field('browser', 'Browser')
        .field('viewport', '123x456')
        .field('device', 'Desktop')
        .field('diffTollerancePercent', '0.12')
        .field('merge', 'true')
        .field('ignoreAreas', '[{"id":"1692476944110","x":182,"y":28,"width":38,"height":30}]')
        .field('comment', 'Comment')
        .expect(201);
    });

    it('should post multipart required fields', async () => {
      const { req } = await post();

      await req.expect(201);
    });

    it('404 for a project that does not exist, storing nothing', async () => {
      const projectId = randomUUID();
      const { build, req } = await post(projectId);

      const res = await req.expect(404);

      expect(res.body.message).toBe(`Project not found: ${projectId}`);
      expect(await testRunsService.findMany(build.id)).toEqual([]);
    });
  });

  describe('POST /approve', () => {
    it('approve changes in new main branch', async () => {
      const testRun = await haveRun(project.mainBranchName, image_v1);

      const result = await testRunsService.approve(testRun.id);

      expect(result.status).toBe(TestStatus.approved);
      expect((await detailsOf(result.testVariationId)).baselines).toHaveLength(1);
    });

    it('approve changes in new feature branch', async () => {
      const testRun = await haveRun('develop', image_v1);

      const result = await testRunsService.approve(testRun.id);

      expect(result.status).toBe(TestStatus.approved);
      const testVariation = await detailsOf(result.testVariationId);
      expect(testVariation.baselines).toHaveLength(1);
      expect(testVariation.branchName).toBe('develop');
    });

    it('approve changes in main vs feature branch', async () => {
      await haveApprovedRun(project.mainBranchName, image_v1);
      const testRun = await haveRun('develop', image_v2);

      const featureBranchResult = await testRunsService.approve(testRun.id);

      expect(featureBranchResult.status).toBe(TestStatus.approved);
      const testVariation = await detailsOf(featureBranchResult.testVariationId);
      expect(testVariation.baselines).toHaveLength(1);
      expect(testVariation.branchName).toBe('develop');
    });

    it('approve changes in updated main vs feature branch', async () => {
      await haveApprovedRun('develop', image_v1);
      await haveApprovedRun(project.mainBranchName, image_v2);
      const testRun = await haveRun('develop', image_v1);

      const result = await testRunsService.approve(testRun.id);

      expect(result.status).toBe(TestStatus.approved);
      expect(result.baselineBranchName).toBe(project.mainBranchName);
      const testVariation = await detailsOf(result.testVariationId);
      expect(testVariation.branchName).toBe('develop');
      expect(testVariation.baselines).toHaveLength(2);
    });

    it('approve changes with merge', async () => {
      const mainBranchResult = await testRunsService.approve((await haveRun(project.mainBranchName, image_v1)).id);
      const testRun = await haveRun('develop', image_v2, true);

      const featureBranchResult = await testRunsService.approve(testRun.id, true);

      expect(featureBranchResult.status).toBe(TestStatus.approved);
      expect(featureBranchResult.merge).toBe(true);
      const mainBranchTestVariation = await detailsOf(mainBranchResult.testVariationId);
      expect(mainBranchTestVariation.baselines).toHaveLength(2);
      expect(mainBranchTestVariation.baselines.shift()!.baselineName).toBe(mainBranchTestVariation.baselineName);
    });

    it('approve feature branch testVariation', async () => {
      const mainBranchResult = await testRunsService.approve((await haveRun(project.mainBranchName, image_v1)).id);
      const testRun = await haveRun('develop', image_v2);

      const featureBranchResult = await testRunsService.approve(testRun.id);

      expect(featureBranchResult.status).toBe(TestStatus.approved);
      expect((await detailsOf(mainBranchResult.testVariationId)).baselines).toHaveLength(1);
    });

    it('autoApprove feature branch testVariation', async () => {
      const mainBranchResult = await testRunsService.approve((await haveRun(project.mainBranchName, image_v1)).id);
      const testRun = await haveRun('develop', image_v2);

      const featureBranchResult = await testRunsService.approve(testRun.id, false, true);

      expect(featureBranchResult.status).toBe(TestStatus.autoApproved);
      expect(mainBranchResult.testVariationId).toBe(featureBranchResult.testVariationId);
    });
  });
});
