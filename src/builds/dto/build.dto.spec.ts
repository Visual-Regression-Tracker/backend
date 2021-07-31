import { Build, TestRun, TestStatus } from '@prisma/client';
import { generateTestRun } from '../../_data_';
import { BuildDto } from './build.dto';

describe('BuildDto', () => {
  it.each([
    [
      'undefined testRuns',
      {
        id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
        ciBuildId: 'ciBuildId',
        number: null,
        branchName: 'develop',
        status: null,
        projectId: 'e0a37894-6f29-478d-b13e-6182fecc715e',
        updatedAt: new Date(),
        createdAt: new Date(),
        userId: null,
        isRunning: true,
        testRuns: undefined,
        merge: false,
      },
    ],
    [
      'empty testRuns',
      {
        id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
        ciBuildId: 'ciBuildId',
        number: null,
        branchName: 'develop',
        status: null,
        projectId: 'e0a37894-6f29-478d-b13e-6182fecc715e',
        updatedAt: new Date(),
        createdAt: new Date(),
        userId: null,
        isRunning: true,
        testRuns: [],
        merge: false,
      },
    ],
  ])('new with %s', (_, build) => {
    const buildDto: BuildDto = {
      id: build.id,
      ciBuildId: build.ciBuildId,
      number: build.number,
      branchName: build.branchName,
      status: 'new',
      projectId: build.projectId,
      updatedAt: build.updatedAt,
      createdAt: build.createdAt,
      userId: null,
      passedCount: 0,
      unresolvedCount: 0,
      failedCount: 0,
      isRunning: true,
      merge: false,
    };

    const result = new BuildDto(build);

    expect(result).toEqual(buildDto);
  });

  it('passed', () => {
    const build: Build & {
      testRuns: TestRun[];
    } = {
      id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
      ciBuildId: 'ciBuildId',
      number: null,
      branchName: 'develop',
      status: null,
      projectId: 'e0a37894-6f29-478d-b13e-6182fecc715e',
      updatedAt: new Date(),
      createdAt: new Date(),
      userId: null,
      isRunning: true,
      testRuns: [
        generateTestRun({ status: TestStatus.ok, merge: true }),
        generateTestRun({ status: TestStatus.approved, merge: true }),
      ],
    };
    const buildDto: BuildDto = {
      id: build.id,
      ciBuildId: build.ciBuildId,
      number: build.number,
      branchName: build.branchName,
      status: 'passed',
      projectId: build.projectId,
      updatedAt: build.updatedAt,
      createdAt: build.createdAt,
      userId: null,
      passedCount: 2,
      unresolvedCount: 0,
      failedCount: 0,
      isRunning: true,
      merge: true,
    };

    const result = new BuildDto(build);

    expect(result).toEqual(buildDto);
  });

  it('failed', () => {
    const build: Build & { testRuns: TestRun[] } = {
      id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
      ciBuildId: 'ciBuildId',
      number: null,
      branchName: 'develop',
      status: null,
      projectId: 'e0a37894-6f29-478d-b13e-6182fecc715e',
      updatedAt: new Date(),
      createdAt: new Date(),
      userId: null,
      isRunning: true,
      testRuns: [
        generateTestRun({ status: TestStatus.ok }),
        generateTestRun({ status: TestStatus.approved }),
        generateTestRun({ status: TestStatus.failed }),
      ],
    };
    const buildDto: BuildDto = {
      id: build.id,
      ciBuildId: build.ciBuildId,
      number: build.number,
      branchName: build.branchName,
      status: 'failed',
      projectId: build.projectId,
      updatedAt: build.updatedAt,
      createdAt: build.createdAt,
      userId: null,
      passedCount: 2,
      unresolvedCount: 0,
      failedCount: 1,
      isRunning: true,
      merge: false,
    };

    const result = new BuildDto(build);

    expect(result).toEqual(buildDto);
  });

  it('unresolved', () => {
    const build: Build & { testRuns: TestRun[] } = {
      id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
      ciBuildId: 'ciBuildId',
      number: null,
      branchName: 'develop',
      status: null,
      projectId: 'e0a37894-6f29-478d-b13e-6182fecc715e',
      updatedAt: new Date(),
      createdAt: new Date(),
      userId: null,
      isRunning: true,
      testRuns: [
        generateTestRun({ status: TestStatus.ok }),
        generateTestRun({ status: TestStatus.approved }),
        generateTestRun({ status: TestStatus.failed }),
        generateTestRun({ status: TestStatus.new }),
        generateTestRun({ status: TestStatus.unresolved }),
      ],
    };
    const buildDto: BuildDto = {
      id: build.id,
      ciBuildId: build.ciBuildId,
      number: build.number,
      branchName: build.branchName,
      status: 'unresolved',
      projectId: build.projectId,
      updatedAt: build.updatedAt,
      createdAt: build.createdAt,
      userId: null,
      passedCount: 2,
      unresolvedCount: 2,
      failedCount: 1,
      isRunning: true,
      merge: false,
    };

    const result = new BuildDto(build);

    expect(result).toEqual(buildDto);
  });
});
