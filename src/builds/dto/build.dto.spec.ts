import { Build, TestRun, TestStatus } from '@prisma/client';
import { generateTestRun, TEST_BUILD } from '../../_data_';
import { BuildDto } from './build.dto';

const makeBuild = (testRuns?: TestRun[]): Build & { testRuns?: TestRun[] } => ({
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
  testRuns,
});

describe('BuildDto', () => {
  it.each([
    ['new', 'undefined testRuns', undefined, { passedCount: 0, unresolvedCount: 0, failedCount: 0, merge: false }],
    ['new', 'empty testRuns', [], { passedCount: 0, unresolvedCount: 0, failedCount: 0, merge: false }],
    [
      'passed',
      'passed and approved merge runs',
      [
        generateTestRun({ status: TestStatus.ok, merge: true }),
        generateTestRun({ status: TestStatus.approved, merge: true }),
      ],
      { passedCount: 2, unresolvedCount: 0, failedCount: 0, merge: true },
    ],
    [
      'failed',
      'a failed run',
      [
        generateTestRun({ status: TestStatus.ok }),
        generateTestRun({ status: TestStatus.approved }),
        generateTestRun({ status: TestStatus.failed }),
      ],
      { passedCount: 2, unresolvedCount: 0, failedCount: 1, merge: false },
    ],
    [
      'unresolved',
      'new and unresolved runs',
      [
        generateTestRun({ status: TestStatus.ok }),
        generateTestRun({ status: TestStatus.approved }),
        generateTestRun({ status: TestStatus.failed }),
        generateTestRun({ status: TestStatus.new }),
        generateTestRun({ status: TestStatus.unresolved }),
      ],
      { passedCount: 2, unresolvedCount: 2, failedCount: 1, merge: false },
    ],
  ])('is %s with %s', (status, _, testRuns, counts) => {
    const build = makeBuild(testRuns);

    expect(new BuildDto(build)).toEqual({
      id: build.id,
      ciBuildId: build.ciBuildId,
      number: null,
      branchName: 'develop',
      status,
      projectId: build.projectId,
      updatedAt: build.updatedAt,
      createdAt: build.createdAt,
      userId: null,
      isRunning: true,
      ...counts,
    });
  });

  it.each([
    ['counts auto-approved test runs as passed', TestStatus.autoApproved, 1],
    ['is passed when it has runs but none in a known status group', 'resolved' as TestStatus, 0],
  ])('%s', (_, status, passedCount) => {
    const result = new BuildDto({ ...TEST_BUILD, testRuns: [generateTestRun({ status })] });

    expect(result).toMatchObject({ status: 'passed', passedCount, unresolvedCount: 0, failedCount: 0 });
  });

  describe('with stats aggregated by the database', () => {
    const build: Build = { ...makeBuild(), number: 7, status: 'stored status', userId: 'userId', isRunning: false };

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

    it('derives the status from the runs, never from the stored column', () => {
      expect(new BuildDto(build).status).toBe('new');
    });
  });
});
