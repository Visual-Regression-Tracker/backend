import { INestApplication } from '@nestjs/common';
import { Project, TestStatus } from '@prisma/client';
import { existsSync } from 'fs';
import { CLEANUP_LOCK_KEY, TasksService } from '../src/shared/tasks/tasks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';
import { BuildsService } from '../src/builds/builds.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { HddService } from '../src/static/hdd/hdd.service';
import { TestVariationsService } from '../src/test-variations/test-variations.service';
import { createE2eApp, haveProject as createProject, waitFor } from './api-helpers';
import { haveTestRunCreated } from './preconditions';

const DAY = 24 * 60 * 60 * 1000;
const image = './test/image.png';

describe('Tasks: cleanOldTestVariations (e2e)', () => {
  let app: INestApplication;
  let tasksService: TasksService;
  let prismaService: PrismaService;
  let projectsService: ProjectsService;
  let buildsService: BuildsService;
  let testRunsService: TestRunsService;
  let hddService: HddService;
  let testVariationsService: TestVariationsService;
  const projectIds: string[] = [];

  beforeAll(async () => {
    const created = await createE2eApp({ validation: false });
    app = created.app;
    tasksService = created.get(TasksService);
    prismaService = created.get(PrismaService);
    projectsService = created.get(ProjectsService);
    buildsService = created.get(BuildsService);
    testRunsService = created.get(TestRunsService);
    hddService = created.get(HddService);
    testVariationsService = created.get(TestVariationsService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const id of projectIds.splice(0)) {
      await projectsService.remove(id);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const haveProject = async (maxBranchLifetime: number): Promise<Project> => {
    const project = await createProject(projectsService, 'Tasks E2E', {
      maxBuildAllowed: 100,
      maxBranchLifetime,
      autoApproveFeature: false,
    });
    projectIds.push(project.id);
    return project;
  };

  const haveApprovedVariation = async (project: Project, branchName: string) => {
    const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, branchName, image);
    const approved = await testRunsService.approve(testRun.id, true);
    const variation = (await prismaService.testVariation.findUnique({
      where: { id: approved.testVariationId! },
      include: { baselines: true },
    }))!;
    expect(variation.branchName).toBe(branchName);
    expect(variation.baselines).toHaveLength(1);
    return { variation, testRun: approved };
  };

  const ageBy = async (variationId: string, days: number) => {
    const then = new Date(Date.now() - days * DAY);
    await prismaService.$executeRaw`UPDATE "TestVariation" SET "updatedAt" = ${then} WHERE "id" = ${variationId}`;
    await prismaService.testRun.updateMany({ where: { testVariationId: variationId }, data: { createdAt: then } });
  };

  it('removes feature-branch variations not used within maxBranchLifetime, with their baselines', async () => {
    const project = await haveProject(5);
    const old = await haveApprovedVariation(project, 'feature/old');
    const fresh = await haveApprovedVariation(project, 'feature/fresh');
    const main = await haveApprovedVariation(project, project.mainBranchName);
    await ageBy(old.variation.id, 6);
    await ageBy(fresh.variation.id, 4);
    await ageBy(main.variation.id, 60);
    const oldBaselineFile = hddService.getImagePath(old.variation.baselines[0].baselineName);
    expect(existsSync(oldBaselineFile)).toBe(true);

    await tasksService.cleanOldTestVariations();

    const variations = await prismaService.testVariation.findMany({ where: { projectId: project.id } });
    expect(variations.map((variation) => variation.id).sort()).toEqual([fresh.variation.id, main.variation.id].sort());
    expect(await prismaService.baseline.findMany({ where: { testVariationId: old.variation.id } })).toEqual([]);
    await waitFor(() => !existsSync(oldBaselineFile));

    const oldRun = (await prismaService.testRun.findUnique({ where: { id: old.testRun.id } }))!;
    expect(oldRun).toMatchObject({ testVariationId: null, status: TestStatus.approved, branchName: 'feature/old' });
    expect(existsSync(hddService.getImagePath(oldRun.imageName))).toBe(true);
    expect(await prismaService.baseline.count({ where: { testVariationId: fresh.variation.id } })).toBe(1);
    expect(await prismaService.baseline.count({ where: { testVariationId: main.variation.id } })).toBe(1);
  });

  it('never removes variations of the main branch, whatever their age', async () => {
    const project = await haveProject(0);
    const main = await haveApprovedVariation(project, project.mainBranchName);
    await ageBy(main.variation.id, 3650);

    await tasksService.cleanOldTestVariations();

    expect(await prismaService.testVariation.findUnique({ where: { id: main.variation.id } })).not.toBeNull();
  });

  it('with maxBranchLifetime 0 removes every feature-branch variation, even one updated a moment ago', async () => {
    const project = await haveProject(0);
    const feature = await haveApprovedVariation(project, 'feature/now');

    await tasksService.cleanOldTestVariations();

    expect(await prismaService.testVariation.findUnique({ where: { id: feature.variation.id } })).toBeNull();
  });

  it('uses the lifetime of each project separately', async () => {
    const shortLived = await haveProject(1);
    const longLived = await haveProject(30);
    const removed = await haveApprovedVariation(shortLived, 'feature/x');
    const kept = await haveApprovedVariation(longLived, 'feature/x');
    await ageBy(removed.variation.id, 2);
    await ageBy(kept.variation.id, 2);

    await tasksService.cleanOldTestVariations();

    expect(await prismaService.testVariation.findUnique({ where: { id: removed.variation.id } })).toBeNull();
    expect(await prismaService.testVariation.findUnique({ where: { id: kept.variation.id } })).not.toBeNull();
  });

  it('approving on the branch refreshes the variation, so it is kept', async () => {
    const project = await haveProject(5);
    const feature = await haveApprovedVariation(project, 'feature/active');
    await ageBy(feature.variation.id, 10);
    const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'feature/active', image);
    await testRunsService.approve(testRun.id, true);

    await tasksService.cleanOldTestVariations();

    expect(await prismaService.testVariation.findUnique({ where: { id: feature.variation.id } })).not.toBeNull();
  });

  it('a branch still receiving passing test runs is kept, though its variation is not updated', async () => {
    const project = await haveProject(5);
    const feature = await haveApprovedVariation(project, 'feature/active');
    await ageBy(feature.variation.id, 10);
    const { testRun } = await haveTestRunCreated(buildsService, testRunsService, project.id, 'feature/active', image);
    expect(testRun.status).toBe(TestStatus.ok);
    const { updatedAt } = (await prismaService.testVariation.findUnique({ where: { id: feature.variation.id } }))!;
    expect(updatedAt.getTime()).toBeLessThan(Date.now() - 5 * DAY);

    await tasksService.cleanOldTestVariations();

    expect(await prismaService.testVariation.findUnique({ where: { id: feature.variation.id } })).not.toBeNull();
    expect((await prismaService.testRun.findUnique({ where: { id: testRun.id } }))!.testVariationId).toBe(
      feature.variation.id
    );
  });

  it('two instances running it at once remove each stale variation once', async () => {
    const project = await haveProject(5);
    const stale: string[] = [];
    for (const branchName of ['feature/a', 'feature/b', 'feature/c']) {
      const { variation } = await haveApprovedVariation(project, branchName);
      await ageBy(variation.id, 6);
      stale.push(variation.id);
    }
    const deleteSpy = jest.spyOn(testVariationsService, 'delete');

    await Promise.all([tasksService.cleanOldTestVariations(), tasksService.cleanOldTestVariations()]);

    const deleted = deleteSpy.mock.calls.map(([id]) => id).filter((id) => stale.includes(id));
    expect(deleted.sort()).toEqual([...stale].sort());
    expect(await prismaService.testVariation.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('skips while another instance holds the cleanup lock', async () => {
    const project = await haveProject(5);
    const { variation } = await haveApprovedVariation(project, 'feature/old');
    await ageBy(variation.id, 6);
    const otherInstance = prismaService.dedicatedClient();
    await otherInstance.connect();
    try {
      await otherInstance.query('BEGIN');
      const { rows } = await otherInstance.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [CLEANUP_LOCK_KEY]);
      expect(rows[0].locked).toBe(true);

      await tasksService.cleanOldTestVariations();

      expect(await prismaService.testVariation.findUnique({ where: { id: variation.id } })).not.toBeNull();
    } finally {
      await otherInstance.end();
    }

    await tasksService.cleanOldTestVariations();

    expect(await prismaService.testVariation.findUnique({ where: { id: variation.id } })).toBeNull();
  });
});
