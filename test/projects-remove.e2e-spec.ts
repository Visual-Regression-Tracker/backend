import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { Project } from '@prisma/client';
import { BuildsService } from '../src/builds/builds.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { createE2eApp, haveProject, imageExists } from './api-helpers';
import { haveTestRunCreated } from './preconditions';

describe('Project removal (e2e)', () => {
  let app: INestApplication;
  let projectsService: ProjectsService;
  let buildsService: BuildsService;
  let testRunsService: TestRunsService;
  let prisma: PrismaService;
  let project: Project;

  beforeAll(async () => {
    const created = await createE2eApp();
    app = created.app;
    projectsService = created.get(ProjectsService);
    buildsService = created.get(BuildsService);
    testRunsService = created.get(TestRunsService);
    prisma = created.get(PrismaService);
  });

  beforeEach(async () => {
    project = await haveProject(projectsService, 'Remove E2E');
  });

  afterEach(async () => {
    await prisma.project.deleteMany({ where: { id: project.id } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('removes builds, runs, variations, baselines and their files in one go', async () => {
    const { testRun } = await haveTestRunCreated(
      buildsService,
      testRunsService,
      project.id,
      project.mainBranchName,
      './test/image.png'
    );
    const approved = await testRunsService.approve(testRun.id, false);
    const baseline = await prisma.baseline.findFirstOrThrow({ where: { testRunId: approved.id } });
    const { imageName } = await prisma.testRun.findUniqueOrThrow({ where: { id: testRun.id } });
    expect(imageExists(imageName)).toBe(true);
    expect(imageExists(baseline.baselineName)).toBe(true);

    await projectsService.remove(project.id);

    expect(await prisma.project.count({ where: { id: project.id } })).toBe(0);
    expect(await prisma.build.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.testVariation.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.testRun.count({ where: { id: testRun.id } })).toBe(0);
    expect(await prisma.baseline.count({ where: { id: baseline.id } })).toBe(0);
    expect(imageExists(imageName)).toBe(false);
    expect(imageExists(baseline.baselineName)).toBe(false);
  });

  it('answers 404 for a project removed already', async () => {
    await projectsService.remove(project.id);

    await expect(projectsService.remove(project.id)).rejects.toThrow(
      new HttpException('Project not found', HttpStatus.NOT_FOUND)
    );
  });
});
