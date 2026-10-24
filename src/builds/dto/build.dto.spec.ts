import { Build, TestRun, TestStatus } from '@prisma/client';
import { generateTestRun, TEST_BUILD } from '../../_data_';
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

  it('counts auto-approved test runs as passed', () => {
    const result = new BuildDto({
      ...TEST_BUILD,
      testRuns: [generateTestRun({ status: TestStatus.autoApproved })],
    } as Build & { testRuns: TestRun[] });

    expect(result).toMatchObject({ status: 'passed', passedCount: 1, unresolvedCount: 0, failedCount: 0 });
  });

  it('is passed when its loaded test runs have a status outside the known groups', () => {
    const result = new BuildDto({
      ...TEST_BUILD,
      testRuns: [generateTestRun({ status: 'resolved' as TestStatus })],
    } as Build & { testRuns: TestRun[] });

    // NOTE: current behavior — the run counts nowhere, but having runs at all makes it "passed"
    expect(result).toMatchObject({ status: 'passed', passedCount: 0, unresolvedCount: 0, failedCount: 0 });
  });

  describe('with stats aggregated by the database', () => {
    const build: Build & { testRuns?: TestRun[] } = {
      id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
      ciBuildId: 'ciBuildId',
      number: 7,
      branchName: 'develop',
      status: 'stored status',
      projectId: 'e0a37894-6f29-478d-b13e-6182fecc715e',
      updatedAt: new Date(),
      createdAt: new Date(),
      userId: 'userId',
      isRunning: false,
    };

    it.each([
      ['new', { passedCount: 0, unresolvedCount: 0, failedCount: 0, merge: false }],
      ['passed', { passedCount: 4, unresolvedCount: 0, failedCount: 0, merge: true }],
      ['failed', { passedCount: 4, unresolvedCount: 0, failedCount: 2, merge: false }],
      ['unresolved', { passedCount: 4, unresolvedCount: 1, failedCount: 2, merge: false }],
    ])('is %s and takes the counts and merge flag from the stats', (status, stats) => {
      const result = new BuildDto(build, stats);

      expect(result).toEqual({
        id: build.id,
        ciBuildId: build.ciBuildId,
        number: 7,
        branchName: 'develop',
        status,
        projectId: build.projectId,
        updatedAt: build.updatedAt,
        createdAt: build.createdAt,
        userId: 'userId',
        isRunning: false,
        ...stats,
      });
    });

    it('ignores the loaded test runs when stats are given', () => {
      const result = new BuildDto(
        { ...build, testRuns: [generateTestRun({ status: TestStatus.failed, merge: true })] },
        { passedCount: 0, unresolvedCount: 0, failedCount: 0, merge: false }
      );

      expect(result).toMatchObject({ status: 'new', passedCount: 0, failedCount: 0, merge: false });
    });

    it('never keeps the status stored on the build', () => {
      // NOTE: current behavior — build.status is copied and then always overwritten
      expect(new BuildDto(build).status).toBe('new');
    });
  });
});
