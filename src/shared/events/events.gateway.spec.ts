import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Build, TestStatus } from '@prisma/client';
import { Server } from 'socket.io';
import { EventsGateway } from './events.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { BuildDto } from '../../builds/dto/build.dto';
import { TestRunDto } from '../../test-runs/dto/testRun.dto';
import { generateTestRun, TEST_BUILD } from '../../_data_';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const initGateway = async () => {
  const buildFindManyMock = jest.fn().mockResolvedValue([]);
  const testRunGroupByMock = jest.fn().mockResolvedValue([]);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EventsGateway,
      {
        provide: PrismaService,
        useValue: {
          build: { findMany: buildFindManyMock },
          testRun: { groupBy: testRunGroupByMock },
        },
      },
    ],
  }).compile();

  const gateway = module.get<EventsGateway>(EventsGateway);
  const emitMock = jest.fn();
  gateway.server = { emit: emitMock } as unknown as Server;
  return { gateway, emitMock, buildFindManyMock, testRunGroupByMock };
};

const emitsOf = (emitMock: jest.Mock, event: string) =>
  emitMock.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload);

describe('EventsGateway', () => {
  const testRunA = generateTestRun({ id: 'testRunA', buildId: 'buildX' });
  const testRunB = generateTestRun({ id: 'testRunB', buildId: 'buildX' });
  const testRunC = generateTestRun({ id: 'testRunC', buildId: 'buildY' });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it.each([
    ['buildCreated', 'build_created'],
    ['buildDeleted', 'build_deleted'],
  ] as const)('%s emits %s straight away with the build it is given', async (method, event) => {
    const { gateway, emitMock } = await initGateway();
    const build = new BuildDto(TEST_BUILD);

    gateway[method](build);

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(event, build);
  });

  describe.each([
    ['testRunCreated', 'testRun_created'],
    ['testRunUpdated', 'testRun_updated'],
    ['testRunDeleted', 'testRun_deleted'],
  ] as const)('%s', (method, event) => {
    it('emits the first test run on the leading edge', async () => {
      const { gateway, emitMock } = await initGateway();

      gateway[method](testRunA);

      expect(emitsOf(emitMock, event)).toEqual([[new TestRunDto(testRunA)]]);
    });

    it('does not emit again after the wait when only one test run came in', async () => {
      const { gateway, emitMock } = await initGateway();

      gateway[method](testRunA);
      jest.advanceTimersByTime(5000);

      expect(emitsOf(emitMock, event)).toEqual([[new TestRunDto(testRunA)]]);
    });

    it('batches the test runs that follow the leading edge into one emit 1500ms after the last call', async () => {
      const { gateway, emitMock } = await initGateway();

      gateway[method](testRunA);
      gateway[method](testRunB);
      jest.advanceTimersByTime(1000);
      gateway[method](testRunC);
      jest.advanceTimersByTime(1499);

      expect(emitsOf(emitMock, event)).toEqual([[new TestRunDto(testRunA)]]);

      jest.advanceTimersByTime(1);

      expect(emitsOf(emitMock, event)).toEqual([
        [new TestRunDto(testRunA)],
        [new TestRunDto(testRunB), new TestRunDto(testRunC)],
      ]);
    });

    it('flushes a steady stream of test runs at the 3000ms max wait', async () => {
      const { gateway, emitMock } = await initGateway();

      gateway[method](testRunA);
      jest.advanceTimersByTime(1000);
      gateway[method](testRunB);
      jest.advanceTimersByTime(1000);
      gateway[method](testRunC);
      jest.advanceTimersByTime(999);

      expect(emitsOf(emitMock, event)).toEqual([[new TestRunDto(testRunA)]]);

      jest.advanceTimersByTime(1);

      expect(emitsOf(emitMock, event)).toEqual([
        [new TestRunDto(testRunA)],
        [new TestRunDto(testRunB), new TestRunDto(testRunC)],
      ]);
    });

    it('queues a build update for the build of the test run', async () => {
      const { gateway, buildFindManyMock } = await initGateway();

      gateway[method](testRunC);

      expect(buildFindManyMock).toHaveBeenCalledWith({ where: { id: { in: ['buildY'] } } });
    });
  });

  describe('testRunDeleted', () => {
    it('drops the deleted test run from the created and updated queues', async () => {
      const { gateway, emitMock } = await initGateway();

      gateway.testRunCreated(testRunA);
      gateway.testRunCreated(testRunB);
      gateway.testRunCreated(testRunC);
      gateway.testRunUpdated(testRunA);
      gateway.testRunUpdated(testRunB);
      gateway.testRunDeleted(testRunB);

      jest.advanceTimersByTime(1500);

      expect(emitsOf(emitMock, 'testRun_created')).toEqual([[new TestRunDto(testRunA)], [new TestRunDto(testRunC)]]);
      expect(emitsOf(emitMock, 'testRun_updated')).toEqual([[new TestRunDto(testRunA)]]);
      expect(emitsOf(emitMock, 'testRun_deleted')).toEqual([[new TestRunDto(testRunB)]]);
    });

    it('keeps the other queued updates when one updated test run is deleted', async () => {
      const { gateway, emitMock } = await initGateway();

      gateway.testRunUpdated(testRunA);
      gateway.testRunUpdated(testRunB);
      gateway.testRunUpdated(testRunC);
      gateway.testRunDeleted(testRunB);

      jest.advanceTimersByTime(1500);

      expect(emitsOf(emitMock, 'testRun_updated')).toEqual([[new TestRunDto(testRunA)], [new TestRunDto(testRunC)]]);
    });

    it('emits nothing once every queued entry was deleted', async () => {
      const { gateway, emitMock } = await initGateway();

      gateway.testRunUpdated(testRunA);
      gateway.testRunUpdated(testRunB);
      gateway.testRunDeleted(testRunB);

      jest.advanceTimersByTime(1500);

      expect(emitsOf(emitMock, 'testRun_updated')).toEqual([[new TestRunDto(testRunA)]]);
    });
  });

  describe('payload', () => {
    it.each([
      ['testRunCreated', 'testRun_created'],
      ['testRunUpdated', 'testRun_updated'],
      ['testRunDeleted', 'testRun_deleted'],
    ] as const)('%s emits TestRunDto, not the database row', async (method, event) => {
      const { gateway, emitMock } = await initGateway();
      const row = generateTestRun({ id: 'row', changeSignature: '[0.5]', pixelMisMatchCount: 7 });

      gateway[method](row);

      const [[payload]] = emitsOf(emitMock, event);
      expect(payload).toBeInstanceOf(TestRunDto);
      expect(payload).toStrictEqual(new TestRunDto(row));
      expect(payload).not.toHaveProperty('changeSignature');
      expect(payload).not.toHaveProperty('createdAt');
    });
  });

  describe('ordering and de-duplication', () => {
    it('sends an update of a run still queued as created with both the created and the updated event', async () => {
      const { gateway, emitMock } = await initGateway();
      const diffed = { ...testRunB, status: TestStatus.unresolved, diffName: 'diff.png' };
      const approved = { ...diffed, status: TestStatus.approved };

      gateway.testRunCreated(testRunA);
      gateway.testRunCreated(testRunB);
      gateway.testRunUpdated(diffed);
      gateway.testRunUpdated(approved);
      jest.advanceTimersByTime(1500);

      expect(emitsOf(emitMock, 'testRun_created')).toEqual([[new TestRunDto(testRunA)], [new TestRunDto(approved)]]);
      expect(emitsOf(emitMock, 'testRun_updated')).toEqual([[new TestRunDto(diffed)], [new TestRunDto(approved)]]);
    });

    it('sends an update of a run already announced as created as an update', async () => {
      const { gateway, emitMock } = await initGateway();
      const diffed = { ...testRunA, status: TestStatus.unresolved };

      gateway.testRunCreated(testRunA);
      gateway.testRunUpdated(diffed);

      expect(emitsOf(emitMock, 'testRun_created')).toEqual([[new TestRunDto(testRunA)]]);
      expect(emitsOf(emitMock, 'testRun_updated')).toEqual([[new TestRunDto(diffed)]]);
    });

    it('keeps only the latest queued update of a run, in the order the runs first came in', async () => {
      const { gateway, emitMock } = await initGateway();
      const first = { ...testRunB, status: TestStatus.unresolved };
      const latest = { ...testRunB, status: TestStatus.approved };

      gateway.testRunUpdated(testRunA);
      gateway.testRunUpdated(first);
      gateway.testRunUpdated(testRunC);
      gateway.testRunUpdated(latest);
      jest.advanceTimersByTime(1500);

      expect(emitsOf(emitMock, 'testRun_updated')).toEqual([
        [new TestRunDto(testRunA)],
        [new TestRunDto(latest), new TestRunDto(testRunC)],
      ]);
    });

    it('announces a deleted run once even when it is deleted twice in a batch', async () => {
      const { gateway, emitMock } = await initGateway();

      gateway.testRunDeleted(testRunA);
      gateway.testRunDeleted(testRunB);
      gateway.testRunDeleted(testRunB);
      jest.advanceTimersByTime(1500);

      expect(emitsOf(emitMock, 'testRun_deleted')).toEqual([[new TestRunDto(testRunA)], [new TestRunDto(testRunB)]]);
    });
  });

  describe('onApplicationShutdown', () => {
    it('drops the batches still waiting for their debounce', async () => {
      const { gateway, emitMock, buildFindManyMock } = await initGateway();

      gateway.testRunCreated(testRunA);
      gateway.testRunCreated(testRunB);
      await flushPromises();
      emitMock.mockClear();
      buildFindManyMock.mockClear();

      gateway.onApplicationShutdown();
      jest.advanceTimersByTime(3000);
      await flushPromises();

      expect(emitMock).not.toHaveBeenCalled();
      expect(buildFindManyMock).not.toHaveBeenCalled();
    });
  });

  describe('build_updated', () => {
    it('emits the build with stats aggregated by the database on the leading edge', async () => {
      const build: Build = { ...TEST_BUILD, id: 'buildX' };
      const { gateway, emitMock, buildFindManyMock, testRunGroupByMock } = await initGateway();
      buildFindManyMock.mockResolvedValue([build]);
      testRunGroupByMock.mockResolvedValueOnce([
        { buildId: 'buildX', status: TestStatus.ok, merge: false, _count: { _all: 3 } },
        { buildId: 'buildX', status: TestStatus.failed, merge: true, _count: { _all: 1 } },
      ]);

      gateway.buildUpdated('buildX');
      await flushPromises();

      expect(buildFindManyMock).toHaveBeenCalledWith({ where: { id: { in: ['buildX'] } } });
      expect(testRunGroupByMock).toHaveBeenCalledWith({
        by: ['buildId', 'status', 'merge'],
        where: { buildId: { in: ['buildX'] } },
        _count: { _all: true },
      });
      const payloads = emitsOf(emitMock, 'build_updated');
      expect(payloads).toHaveLength(1);
      expect(payloads[0]).toEqual([
        new BuildDto(build, { passedCount: 3, unresolvedCount: 0, failedCount: 1, merge: true }),
      ]);
      expect(payloads[0][0]).toMatchObject({ status: 'failed', passedCount: 3, failedCount: 1, merge: true });
    });

    it('logs a failed read instead of leaving the rejection unhandled', async () => {
      const { gateway, emitMock, buildFindManyMock } = await initGateway();
      buildFindManyMock.mockRejectedValue(new Error('Connection terminated'));
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);

      gateway.buildUpdated('buildX');
      await flushPromises();
      await flushPromises();
      process.off('unhandledRejection', unhandled);

      expect(logError).toHaveBeenCalledWith('Cannot emit build_updated: Error: Connection terminated');
      expect(unhandled).not.toHaveBeenCalled();
      expect(emitsOf(emitMock, 'build_updated')).toEqual([]);
      logError.mockRestore();
    });

    it('deduplicates the queued build ids before reading them', async () => {
      const { gateway, buildFindManyMock, testRunGroupByMock } = await initGateway();

      gateway.buildUpdated('first');
      gateway.testRunCreated(testRunA);
      gateway.testRunUpdated(testRunB);
      gateway.testRunDeleted(testRunC);
      gateway.buildUpdated('buildX');
      jest.advanceTimersByTime(1500);
      await flushPromises();

      expect(buildFindManyMock).toHaveBeenCalledTimes(2);
      expect(buildFindManyMock).toHaveBeenNthCalledWith(1, { where: { id: { in: ['first'] } } });
      expect(buildFindManyMock).toHaveBeenNthCalledWith(2, { where: { id: { in: ['buildX', 'buildY'] } } });
      expect(testRunGroupByMock).toHaveBeenCalledWith({
        by: ['buildId', 'status', 'merge'],
        where: { buildId: { in: ['buildX', 'buildY'] } },
        _count: { _all: true },
      });
    });

    it('emits the builds in the order Prisma returns them, without stats for builds it did not ask about', async () => {
      const known: Build = { ...TEST_BUILD, id: 'buildX' };
      const unknown: Build = { ...TEST_BUILD, id: 'other' };
      const { gateway, emitMock, buildFindManyMock } = await initGateway();
      buildFindManyMock.mockResolvedValue([unknown, known]);

      gateway.buildUpdated('buildX');
      await flushPromises();

      expect(emitsOf(emitMock, 'build_updated')).toEqual([
        [
          new BuildDto(unknown),
          new BuildDto(known, { passedCount: 0, unresolvedCount: 0, failedCount: 0, merge: false }),
        ],
      ]);
    });

    it('emits nothing when no queued build exists any more', async () => {
      const { gateway, emitMock } = await initGateway();

      gateway.buildUpdated('gone');
      await flushPromises();

      expect(emitsOf(emitMock, 'build_updated')).toEqual([]);
    });
  });
});
