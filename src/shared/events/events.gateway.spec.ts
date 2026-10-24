import { Test, TestingModule } from '@nestjs/testing';
import { Build, TestStatus } from '@prisma/client';
import { Server } from 'socket.io';
import { EventsGateway } from './events.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { BuildDto } from '../../builds/dto/build.dto';
import { generateTestRun, TEST_BUILD } from '../../_data_';

// the debounced build_updated emit resolves Prisma before emitting; setImmediate
// is left real so the pending promise chain can be drained
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const initGateway = async ({
  buildFindManyMock = jest.fn().mockResolvedValue([]),
  testRunGroupByMock = jest.fn().mockResolvedValue([]),
}) => {
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
  return { gateway, emitMock };
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

  it('emits build_created straight away with the build it is given', async () => {
    const { gateway, emitMock } = await initGateway({});
    const build = new BuildDto(TEST_BUILD);

    gateway.buildCreated(build);

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith('build_created', build);
  });

  it('emits build_deleted straight away with the build it is given', async () => {
    const { gateway, emitMock } = await initGateway({});
    const build = new BuildDto(TEST_BUILD);

    gateway.buildDeleted(build);

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith('build_deleted', build);
  });

  describe.each([
    ['testRunCreated', 'testRun_created'],
    ['testRunUpdated', 'testRun_updated'],
    ['testRunDeleted', 'testRun_deleted'],
  ] as const)('%s', (method, event) => {
    it('emits the first test run on the leading edge', async () => {
      const { gateway, emitMock } = await initGateway({});

      gateway[method](testRunA);

      expect(emitsOf(emitMock, event)).toEqual([[testRunA]]);
    });

    it('does not emit again after the wait when only one test run came in', async () => {
      const { gateway, emitMock } = await initGateway({});

      gateway[method](testRunA);
      jest.advanceTimersByTime(5000);

      expect(emitsOf(emitMock, event)).toEqual([[testRunA]]);
    });

    it('batches the test runs that follow the leading edge into one emit 1500ms after the last call', async () => {
      const { gateway, emitMock } = await initGateway({});

      gateway[method](testRunA);
      gateway[method](testRunB);
      jest.advanceTimersByTime(1000);
      gateway[method](testRunC);
      jest.advanceTimersByTime(1499);

      expect(emitsOf(emitMock, event)).toEqual([[testRunA]]);

      jest.advanceTimersByTime(1);

      expect(emitsOf(emitMock, event)).toEqual([[testRunA], [testRunB, testRunC]]);
    });

    it('flushes a steady stream of test runs at the 3000ms max wait', async () => {
      const { gateway, emitMock } = await initGateway({});

      gateway[method](testRunA);
      jest.advanceTimersByTime(1000);
      gateway[method](testRunB);
      jest.advanceTimersByTime(1000);
      gateway[method](testRunC);
      jest.advanceTimersByTime(999);

      expect(emitsOf(emitMock, event)).toEqual([[testRunA]]);

      jest.advanceTimersByTime(1);

      expect(emitsOf(emitMock, event)).toEqual([[testRunA], [testRunB, testRunC]]);
    });

    it('queues a build update for the build of the test run', async () => {
      const buildFindManyMock = jest.fn().mockResolvedValue([]);
      const { gateway } = await initGateway({ buildFindManyMock });

      gateway[method](testRunC);

      expect(buildFindManyMock).toHaveBeenCalledWith({ where: { id: { in: ['buildY'] } } });
    });
  });

  describe('testRunDeleted', () => {
    it('drops the deleted test run from the created and updated queues', async () => {
      const { gateway, emitMock } = await initGateway({});

      // leading edges go out at once; the second calls are queued
      gateway.testRunCreated(testRunA);
      gateway.testRunCreated(testRunB);
      gateway.testRunCreated(testRunC);
      gateway.testRunUpdated(testRunA);
      gateway.testRunUpdated(testRunB);
      gateway.testRunDeleted(testRunB);

      jest.advanceTimersByTime(1500);

      expect(emitsOf(emitMock, 'testRun_created')).toEqual([[testRunA], [testRunC]]);
      expect(emitsOf(emitMock, 'testRun_deleted')).toEqual([[testRunB]]);
    });

    it('still emits an empty batch once every queued entry was deleted', async () => {
      const { gateway, emitMock } = await initGateway({});

      gateway.testRunUpdated(testRunA);
      gateway.testRunUpdated(testRunB);
      gateway.testRunDeleted(testRunB);

      jest.advanceTimersByTime(1500);

      // NOTE: current behavior — the trailing debounce call still fires with the
      // now-empty queue, so clients receive `testRun_updated` with [].
      expect(emitsOf(emitMock, 'testRun_updated')).toEqual([[testRunA], []]);
    });
  });

  describe('build_updated', () => {
    it('emits the build with stats aggregated by the database on the leading edge', async () => {
      const build: Build = { ...TEST_BUILD, id: 'buildX' };
      const buildFindManyMock = jest.fn().mockResolvedValue([build]);
      const testRunGroupByMock = jest
        .fn()
        .mockResolvedValueOnce([
          { buildId: 'buildX', status: TestStatus.ok, _count: { _all: 3 } },
          { buildId: 'buildX', status: TestStatus.failed, _count: { _all: 1 } },
        ])
        .mockResolvedValueOnce([{ buildId: 'buildX' }]);
      const { gateway, emitMock } = await initGateway({ buildFindManyMock, testRunGroupByMock });

      gateway.buildUpdated('buildX');
      await flushPromises();

      expect(buildFindManyMock).toHaveBeenCalledWith({ where: { id: { in: ['buildX'] } } });
      expect(testRunGroupByMock).toHaveBeenCalledWith({
        by: ['buildId', 'status'],
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

    it('deduplicates the queued build ids before reading them', async () => {
      const buildFindManyMock = jest.fn().mockResolvedValue([]);
      const testRunGroupByMock = jest.fn().mockResolvedValue([]);
      const { gateway } = await initGateway({ buildFindManyMock, testRunGroupByMock });

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
        by: ['buildId'],
        where: { buildId: { in: ['buildX', 'buildY'] }, merge: true },
      });
    });

    it('emits the builds in the order Prisma returns them, without stats for builds it did not ask about', async () => {
      const known: Build = { ...TEST_BUILD, id: 'buildX' };
      const unknown: Build = { ...TEST_BUILD, id: 'other' };
      const buildFindManyMock = jest.fn().mockResolvedValue([unknown, known]);
      const { gateway, emitMock } = await initGateway({ buildFindManyMock });

      gateway.buildUpdated('buildX');
      await flushPromises();

      expect(emitsOf(emitMock, 'build_updated')).toEqual([
        [
          new BuildDto(unknown),
          new BuildDto(known, { passedCount: 0, unresolvedCount: 0, failedCount: 0, merge: false }),
        ],
      ]);
    });

    it('emits an empty list when no queued build exists any more', async () => {
      const { gateway, emitMock } = await initGateway({});

      gateway.buildUpdated('gone');
      await flushPromises();

      expect(emitsOf(emitMock, 'build_updated')).toEqual([[]]);
    });
  });
});
