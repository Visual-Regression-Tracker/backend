import { CLEANUP_LOCK_KEY, TasksService } from './tasks.service';
import { generateTestVariation, TEST_PROJECT } from '../../_data_';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { TestVariationsService } from '../../test-variations/test-variations.service';

// the dedicated pg connection the cleanup takes its lock on
const lockClient = (locked: boolean) => ({
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  query: jest.fn((sql: string) => Promise.resolve(sql === 'BEGIN' ? { rows: [] } : { rows: [{ locked }] })),
  end: jest.fn().mockResolvedValue(undefined),
});

const initService = async ({
  client = lockClient(true),
  projectFindManyMock = jest.fn().mockResolvedValue([]),
  testVariationFindManyMock = jest.fn(),
  testVariationsDeleteMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TasksService,
      {
        provide: PrismaService,
        useValue: {
          dedicatedClient: () => client,
          testVariation: {
            findMany: testVariationFindManyMock,
          },
          project: {
            findMany: projectFindManyMock,
          },
        },
      },
      {
        provide: TestVariationsService,
        useValue: {
          delete: testVariationsDeleteMock,
        },
      },
    ],
  }).compile();

  return module.get<TasksService>(TasksService);
};

describe('cleanOldTestVariations', () => {
  let service: TasksService;

  afterEach(() => {
    jest.useRealTimers();
  });

  it('findMany', async () => {
    // .Arrange
    const project = TEST_PROJECT;
    const testVariation = generateTestVariation();
    const projectFindManyMock = jest.fn().mockResolvedValueOnce([project]);
    const testVariationFindManyMock = jest.fn().mockResolvedValueOnce([testVariation]);
    const testVariationsDeleteMock = jest.fn();
    service = await initService({
      projectFindManyMock: projectFindManyMock,
      testVariationFindManyMock: testVariationFindManyMock,
      testVariationsDeleteMock: testVariationsDeleteMock,
    });
    const dateNow = new Date('2022-10-23');
    jest.useFakeTimers().setSystemTime(dateNow);
    const dateRemoveAfter: Date = new Date(dateNow);
    dateRemoveAfter.setDate(dateRemoveAfter.getDate() - project.maxBranchLifetime);

    // .Act
    await service.cleanOldTestVariations();

    // .Assert
    expect(testVariationFindManyMock).toHaveBeenCalledWith({
      where: {
        updatedAt: { lte: dateRemoveAfter },
        // nor run since: a run that matches the baseline does not move updatedAt
        testRuns: { none: { createdAt: { gt: dateRemoveAfter } } },
        branchName: { not: project.mainBranchName },
        projectId: project.id,
      },
    });
    expect(testVariationsDeleteMock).toHaveBeenCalledWith(testVariation.id);
  });

  it('removes only while holding the advisory lock, taken in a transaction on its own connection', async () => {
    const client = lockClient(true);
    const projectFindManyMock = jest.fn().mockResolvedValueOnce([TEST_PROJECT]);
    const testVariationFindManyMock = jest.fn().mockResolvedValueOnce([generateTestVariation()]);
    const testVariationsDeleteMock = jest.fn(async () => {
      // the lock is still held: the connection carrying it has not been closed
      expect(client.end).not.toHaveBeenCalled();
    });
    service = await initService({ client, projectFindManyMock, testVariationFindManyMock, testVariationsDeleteMock });

    await service.cleanOldTestVariations();

    expect(client.connect).toHaveBeenCalled();
    expect(client.query.mock.calls).toEqual([
      ['BEGIN'],
      ['SELECT pg_try_advisory_xact_lock($1) AS locked', [CLEANUP_LOCK_KEY]],
    ]);
    expect(testVariationsDeleteMock).toHaveBeenCalledTimes(1);
    // closing the connection ends the transaction and releases the lock
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('skips when another instance holds the lock', async () => {
    const client = lockClient(false);
    const projectFindManyMock = jest.fn();
    const testVariationsDeleteMock = jest.fn();
    service = await initService({ client, projectFindManyMock, testVariationsDeleteMock });
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation();

    await service.cleanOldTestVariations();

    expect(projectFindManyMock).not.toHaveBeenCalled();
    expect(testVariationsDeleteMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('Another instance is removing old test variations, skipping');
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when the cleanup fails', async () => {
    const client = lockClient(true);
    const projectFindManyMock = jest.fn().mockRejectedValueOnce(new Error('connection reset'));
    service = await initService({ client, projectFindManyMock });

    await expect(service.cleanOldTestVariations()).rejects.toThrow('connection reset');

    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('logs a lost lock connection instead of letting the error event crash the process', async () => {
    const client = lockClient(true);
    service = await initService({ client });
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation();

    await service.cleanOldTestVariations();
    const [event, listener] = client.on.mock.calls[0];
    listener(new Error('terminating connection due to administrator command'));

    expect(event).toBe('error');
    expect(warnSpy).toHaveBeenCalledWith(
      'Lost the cleanup lock connection: terminating connection due to administrator command'
    );
  });
});
