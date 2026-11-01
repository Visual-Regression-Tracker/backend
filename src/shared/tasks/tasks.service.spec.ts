import { CLEANUP_LOCK_KEY, TasksService } from './tasks.service';
import { generateTestVariation, TEST_PROJECT } from '../../_data_';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { TestVariationsService } from '../../test-variations/test-variations.service';

const lockClient = (locked: boolean) => ({
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  query: jest.fn((sql: string) => Promise.resolve(sql === 'BEGIN' ? { rows: [] } : { rows: [{ locked }] })),
  end: jest.fn().mockResolvedValue(undefined),
});

const secondProject = { ...TEST_PROJECT, id: '2', name: 'Second Project' };
const variations = (...ids: string[]) => ids.map((id) => generateTestVariation({ id }));

const setup = async (client = lockClient(true)) => {
  const projectFindMany = jest.fn().mockResolvedValue([]);
  const variationFindMany = jest.fn();
  const variationFindFirst = jest.fn(async ({ where }: { where: { id: string } }): Promise<{ id: string } | null> => ({
    id: where.id,
  }));
  const variationDelete = jest.fn();
  const module = await Test.createTestingModule({
    providers: [
      TasksService,
      {
        provide: PrismaService,
        useValue: {
          dedicatedClient: () => client,
          testVariation: { findMany: variationFindMany, findFirst: variationFindFirst },
          project: { findMany: projectFindMany },
        },
      },
      { provide: TestVariationsService, useValue: { delete: variationDelete } },
    ],
  }).compile();

  const service = module.get(TasksService);
  const spyLogger = (method: 'log' | 'warn') => jest.spyOn((service as any).logger, method).mockImplementation();
  return { service, client, projectFindMany, variationFindMany, variationFindFirst, variationDelete, spyLogger };
};

describe('cleanOldTestVariations', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('findMany', async () => {
    const project = TEST_PROJECT;
    const testVariation = generateTestVariation();
    const { service, projectFindMany, variationFindMany, variationDelete } = await setup();
    projectFindMany.mockResolvedValueOnce([project]);
    variationFindMany.mockResolvedValueOnce([testVariation]);
    const dateNow = new Date('2022-10-23');
    jest.useFakeTimers().setSystemTime(dateNow);
    const dateRemoveAfter: Date = new Date(dateNow);
    dateRemoveAfter.setDate(dateRemoveAfter.getDate() - project.maxBranchLifetime);

    await service.cleanOldTestVariations();

    expect(variationFindMany).toHaveBeenCalledWith({
      where: {
        updatedAt: { lte: dateRemoveAfter },
        testRuns: { none: { createdAt: { gt: dateRemoveAfter } } },
        branchName: { not: project.mainBranchName },
        projectId: project.id,
      },
    });
    expect(variationDelete).toHaveBeenCalledWith(testVariation.id);
  });

  it('removes only while holding the advisory lock, taken in a transaction on its own connection', async () => {
    const { service, client, projectFindMany, variationFindMany, variationDelete } = await setup();
    projectFindMany.mockResolvedValueOnce([TEST_PROJECT]);
    variationFindMany.mockResolvedValueOnce([generateTestVariation()]);
    variationDelete.mockImplementation(async () => {
      expect(client.end).not.toHaveBeenCalled();
    });

    await service.cleanOldTestVariations();

    expect(client.connect).toHaveBeenCalled();
    expect(client.query.mock.calls).toEqual([
      ['BEGIN'],
      ['SELECT pg_try_advisory_xact_lock($1) AS locked', [CLEANUP_LOCK_KEY]],
    ]);
    expect(variationDelete).toHaveBeenCalledTimes(1);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('skips when another instance holds the lock', async () => {
    const { service, client, projectFindMany, variationDelete, spyLogger } = await setup(lockClient(false));
    const logSpy = spyLogger('log');

    await service.cleanOldTestVariations();

    expect(projectFindMany).not.toHaveBeenCalled();
    expect(variationDelete).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('Another instance is removing old test variations, skipping');
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when the cleanup fails', async () => {
    const { service, client, projectFindMany } = await setup();
    projectFindMany.mockRejectedValueOnce(new Error('connection reset'));

    await expect(service.cleanOldTestVariations()).rejects.toThrow('connection reset');

    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('logs a lost lock connection instead of letting the error event crash the process', async () => {
    const { service, client, spyLogger } = await setup();
    const warnSpy = spyLogger('warn');

    await service.cleanOldTestVariations();
    const [event, listener] = client.on.mock.calls[0];
    listener(new Error('terminating connection due to administrator command'));

    expect(event).toBe('error');
    expect(warnSpy).toHaveBeenCalledWith(
      'Lost the cleanup lock connection: terminating connection due to administrator command'
    );
  });

  it('one failing variation does not stop the cleanup of the next variation and project', async () => {
    const { service, projectFindMany, variationFindMany, variationDelete, spyLogger } = await setup();
    projectFindMany.mockResolvedValueOnce([TEST_PROJECT, secondProject]);
    variationFindMany.mockResolvedValueOnce(variations('v1', 'v2')).mockResolvedValueOnce(variations('v3'));
    variationDelete.mockRejectedValueOnce(new Error('FK')).mockResolvedValue(undefined);
    spyLogger('warn');

    await expect(service.cleanOldTestVariations()).resolves.toBeUndefined();

    expect(variationDelete.mock.calls).toEqual([['v1'], ['v2'], ['v3']]);
  });

  it('a failing project does not stop the next one', async () => {
    const { service, projectFindMany, variationFindMany, variationDelete, spyLogger } = await setup();
    projectFindMany.mockResolvedValueOnce([TEST_PROJECT, secondProject]);
    variationFindMany.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(variations('v3'));
    variationDelete.mockResolvedValue(undefined);
    const warnSpy = spyLogger('warn');

    await service.cleanOldTestVariations();

    expect(variationDelete.mock.calls).toEqual([['v3']]);
    expect(warnSpy).toHaveBeenCalledWith('Cannot clean up TestVariations of Test Project: Error: db down');
  });

  it('logs a summary per project', async () => {
    const { service, projectFindMany, variationFindMany, variationDelete, spyLogger } = await setup();
    projectFindMany.mockResolvedValueOnce([TEST_PROJECT]);
    variationFindMany.mockResolvedValueOnce(variations('v1', 'v2'));
    variationDelete.mockRejectedValueOnce(new Error('FK')).mockResolvedValue(undefined);
    const logSpy = spyLogger('log');
    spyLogger('warn');

    await service.cleanOldTestVariations();

    expect(logSpy).toHaveBeenCalledWith('Removed 1 of 2 TestVariations of Test Project, 0 in use again, 1 failed');
  });

  it('skips a variation used after the list was read', async () => {
    const { service, projectFindMany, variationFindMany, variationFindFirst, variationDelete, spyLogger } =
      await setup();
    projectFindMany.mockResolvedValueOnce([TEST_PROJECT]);
    variationFindMany.mockResolvedValueOnce(variations('v1', 'v2'));
    variationFindFirst.mockImplementation(async ({ where }) => (where.id === 'v1' ? null : { id: where.id }));
    variationDelete.mockResolvedValue(undefined);
    const logSpy = spyLogger('log');
    spyLogger('warn');

    await service.cleanOldTestVariations();

    const { where: listWhere } = variationFindMany.mock.calls[0][0];
    expect(variationFindFirst.mock.calls).toEqual([
      [{ where: { id: 'v1', ...listWhere }, select: { id: true } }],
      [{ where: { id: 'v2', ...listWhere }, select: { id: true } }],
    ]);
    expect(variationDelete.mock.calls).toEqual([['v2']]);
    expect(logSpy).toHaveBeenCalledWith('Removed 1 of 2 TestVariations of Test Project, 1 in use again, 0 failed');
  });
});
