import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Build, TestStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { EventsGateway } from './events.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { SocketAuthService } from '../../auth/socket-auth.service';
import { BuildDto } from '../../builds/dto/build.dto';
import { TestRunDto } from '../../test-runs/dto/testRun.dto';
import { generateTestRun, TEST_BUILD } from '../../_data_';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const initGateway = async (env: Record<string, string> = {}) => {
  const buildFindManyMock = jest.fn().mockResolvedValue([]);
  const testRunGroupByMock = jest.fn().mockResolvedValue([]);
  const authMiddleware = jest.fn();
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
      { provide: SocketAuthService, useValue: { middleware: () => authMiddleware } },
      { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
    ],
  }).compile();

  const gateway = module.get<EventsGateway>(EventsGateway);
  const emitMock = jest.fn();
  const roomEmitMock = jest.fn();
  const toMock = jest.fn((room: string) => ({
    emit: (event: string, payload: unknown) => roomEmitMock(room, event, payload),
  }));
  gateway.server = { emit: emitMock, to: toMock } as unknown as Server;
  return { gateway, emitMock, roomEmitMock, toMock, buildFindManyMock, testRunGroupByMock, authMiddleware };
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
  describe('connections', () => {
    it('checks the token of every connection with the socket auth middleware', async () => {
      const { gateway, authMiddleware } = await initGateway();
      const use = jest.fn();

      gateway.afterInit({ use } as unknown as Server);

      expect(use).toHaveBeenCalledWith(authMiddleware);
    });
  });

  describe('rooms', () => {
    const projectId = '2f3c5c8e-3b5e-4b1a-9c3e-1f2a3b4c5d6e';
    const buildId = '7a8b9c0d-1e2f-4a3b-8c5d-6e7f8a9b0c1d';
    const socketMock = () => ({ join: jest.fn(), leave: jest.fn() });

    it('join puts the socket into the rooms of the project and the build', async () => {
      const { gateway } = await initGateway();
      const socket = socketMock();

      await gateway.join(socket as unknown as Socket, { projectId, buildId });

      expect(socket.join).toHaveBeenCalledWith([`project:${projectId}`, `build:${buildId}`]);
    });

    it('leave takes the socket out of the rooms of the project and the build', async () => {
      const { gateway } = await initGateway();
      const socket = socketMock();

      await gateway.leave(socket as unknown as Socket, { projectId, buildId });

      expect(socket.leave.mock.calls).toEqual([[`project:${projectId}`], [`build:${buildId}`]]);
    });

    it.each([
      ['only a project', { projectId }, [`project:${projectId}`]],
      ['only a build', { buildId }, [`build:${buildId}`]],
      ['ids that are not uuids', { projectId: 'x', buildId: 42 }, []],
      ['no body', undefined, []],
      ['a body that is not an object', 'abc', []],
    ])('join with %s', async (_case, body, rooms) => {
      const { gateway } = await initGateway();
      const socket = socketMock();

      await gateway.join(socket as unknown as Socket, body);

      expect(socket.join).toHaveBeenCalledWith(rooms);
    });

    it('sends every event to all clients and to no room while WS_BROADCAST is on (the default)', async () => {
      const { gateway, emitMock, toMock } = await initGateway();

      gateway.buildCreated(new BuildDto(TEST_BUILD));
      gateway.testRunCreated(testRunA);

      expect(emitMock).toHaveBeenCalledTimes(2);
      expect(toMock).not.toHaveBeenCalled();
    });

    describe('with WS_BROADCAST=false', () => {
      const env = { WS_BROADCAST: 'false' };

      it.each([
        ['buildCreated', 'build_created'],
        ['buildDeleted', 'build_deleted'],
      ] as const)('%s sends %s to the project room only', async (method, event) => {
        const { gateway, emitMock, roomEmitMock } = await initGateway(env);
        const build = new BuildDto(TEST_BUILD);

        gateway[method](build);

        expect(emitMock).not.toHaveBeenCalled();
        expect(roomEmitMock.mock.calls).toEqual([[`project:${TEST_BUILD.projectId}`, event, build]]);
      });

      it('sends a batch of test runs to the room of each build, with the runs of that build', async () => {
        const { gateway, emitMock, roomEmitMock } = await initGateway(env);

        gateway.testRunUpdated(testRunA);
        gateway.testRunUpdated(testRunB);
        gateway.testRunUpdated(testRunC);
        jest.advanceTimersByTime(1500);

        expect(emitMock).not.toHaveBeenCalled();
        expect(roomEmitMock.mock.calls.filter(([, event]) => event === 'testRun_updated')).toEqual([
          ['build:buildX', 'testRun_updated', [new TestRunDto(testRunA)]],
          ['build:buildX', 'testRun_updated', [new TestRunDto(testRunB)]],
          ['build:buildY', 'testRun_updated', [new TestRunDto(testRunC)]],
        ]);
      });

      it('sends build_updated to the room of each project, with the builds of that project', async () => {
        const one: Build = { ...TEST_BUILD, id: 'one', projectId: 'projectP' };
        const two: Build = { ...TEST_BUILD, id: 'two', projectId: 'projectQ' };
        const three: Build = { ...TEST_BUILD, id: 'three', projectId: 'projectP' };
        const { gateway, emitMock, roomEmitMock, buildFindManyMock } = await initGateway(env);
        buildFindManyMock.mockResolvedValue([one, two, three]);

        gateway.buildUpdated('one');
        await flushPromises();

        expect(emitMock).not.toHaveBeenCalled();
        expect(roomEmitMock.mock.calls).toEqual([
          ['project:projectP', 'build_updated', [new BuildDto(one), new BuildDto(three)]],
          ['project:projectQ', 'build_updated', [new BuildDto(two)]],
        ]);
      });
    });
  });
});
