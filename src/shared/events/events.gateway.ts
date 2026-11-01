import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TestRun } from '@prisma/client';
import { isUUID } from 'class-validator';
import { BuildDto } from '../../builds/dto/build.dto';
import { getBuildsStats } from '../../builds/build-stats';
import { TestRunDto } from '../../test-runs/dto/testRun.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { Debounced, debounce } from './debounce';
import { SocketAuthService } from '../../auth/socket-auth.service';
import { booleanFlag } from '../../utils/env';

const DEBOUNCE_WAIT = 1500;
const MAX_WAIT = 3000;

const TEST_RUN_EVENTS = ['testRun_created', 'testRun_updated', 'testRun_deleted'] as const;
type TestRunEvent = (typeof TEST_RUN_EVENTS)[number];

const projectRoom = (projectId: string) => `project:${projectId}`;
const buildRoom = (buildId: string) => `build:${buildId}`;

interface RoomsBody {
  projectId?: unknown;
  buildId?: unknown;
}

const isUuidString = (value: unknown): value is string => typeof value === 'string' && isUUID(value);

const roomsOf = (body: RoomsBody | null | undefined): string[] => [
  ...(isUuidString(body?.projectId) ? [projectRoom(body.projectId)] : []),
  ...(isUuidString(body?.buildId) ? [buildRoom(body.buildId)] : []),
];

const groupBy = <T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
};

@WebSocketGateway({ cors: true })
export class EventsGateway implements OnGatewayInit, OnApplicationShutdown {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private readonly broadcast: boolean;

  constructor(
    private prismaService: PrismaService,
    private socketAuthService: SocketAuthService,
    configService: ConfigService
  ) {
    this.broadcast = booleanFlag(configService.get('WS_BROADCAST'), true);
  }

  afterInit(server: Server): void {
    server.use(this.socketAuthService.middleware());
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body?: RoomsBody): Promise<string[]> {
    const rooms = roomsOf(body);
    await socket.join(rooms);
    return rooms;
  }

  @SubscribeMessage('leave')
  async leave(@ConnectedSocket() socket: Socket, @MessageBody() body?: RoomsBody): Promise<string[]> {
    const rooms = roomsOf(body);
    for (const room of rooms) {
      await socket.leave(room);
    }
    return rooms;
  }

  private readonly testRunQueues = Object.fromEntries(
    TEST_RUN_EVENTS.map((event) => [event, new Map<string, TestRunDto>()])
  ) as Record<TestRunEvent, Map<string, TestRunDto>>;
  private readonly testRunEmitters = Object.fromEntries(
    TEST_RUN_EVENTS.map((event) => [event, debounce(() => this.emitQueued(event), DEBOUNCE_WAIT, MAX_WAIT)])
  ) as Record<TestRunEvent, Debounced>;
  private readonly buildsUpdatedQueued = new Set<string>();

  buildCreated(build: BuildDto): void {
    this.emitToRoom(projectRoom(build.projectId), 'build_created', build);
  }

  buildUpdated(id: string): void {
    this.buildsUpdatedQueued.add(id);
    this.buildUpdatedDebounced();
  }

  testRunCreated(testRun: TestRun): void {
    this.enqueueTestRun('testRun_created', testRun);
    this.buildUpdated(testRun.buildId);
  }

  testRunUpdated(testRun: TestRun): void {
    // Clients skip testRun_created for runs they already fetched, so the update must go out as well
    if (this.testRunQueues.testRun_created.has(testRun.id)) {
      this.testRunQueues.testRun_created.set(testRun.id, new TestRunDto(testRun));
    }
    this.enqueueTestRun('testRun_updated', testRun);
    this.buildUpdated(testRun.buildId);
  }

  testRunDeleted(testRun: TestRun): void {
    this.testRunQueues.testRun_created.delete(testRun.id);
    this.testRunQueues.testRun_updated.delete(testRun.id);
    this.enqueueTestRun('testRun_deleted', testRun);
    this.buildUpdated(testRun.buildId);
  }

  buildDeleted(buildDto: BuildDto) {
    this.emitToRoom(projectRoom(buildDto.projectId), 'build_deleted', buildDto);
  }

  // Runs after the HTTP server drained: a pending batch would otherwise hit a closed database pool
  onApplicationShutdown(): void {
    TEST_RUN_EVENTS.forEach((event) => this.testRunEmitters[event].cancel());
    this.buildUpdatedDebounced.cancel();
  }

  private enqueueTestRun(event: TestRunEvent, testRun: TestRun): void {
    this.testRunQueues[event].set(testRun.id, new TestRunDto(testRun));
    this.testRunEmitters[event]();
  }

  private emitQueued(event: TestRunEvent): void {
    const queue = this.testRunQueues[event];
    if (queue.size === 0) return;
    const testRuns = [...queue.values()];
    queue.clear();
    this.emitToRooms(event, testRuns, (testRun) => buildRoom(testRun.buildId));
  }

  private emitToRoom(room: string, event: string, payload: unknown): void {
    (this.broadcast ? this.server : this.server.to(room)).emit(event, payload);
  }

  private emitToRooms<T>(event: string, items: T[], roomOf: (item: T) => string): void {
    if (this.broadcast) {
      this.server.emit(event, items);
      return;
    }
    groupBy(items, roomOf).forEach((group, room) => this.emitToRoom(room, event, group));
  }

  private buildUpdatedDebounced = debounce(
    () => {
      const buildIds = [...this.buildsUpdatedQueued];
      this.buildsUpdatedQueued.clear();
      Promise.all([
        this.prismaService.build.findMany({ where: { id: { in: buildIds } } }),
        getBuildsStats(this.prismaService, buildIds),
      ])
        .then(([builds, stats]) => {
          if (builds.length === 0) return;
          this.emitToRooms(
            'build_updated',
            builds.map((build) => new BuildDto(build, stats.get(build.id))),
            (build) => projectRoom(build.projectId)
          );
        })
        .catch((error) => this.logger.error(`Cannot emit build_updated: ${error}`));
    },
    DEBOUNCE_WAIT,
    MAX_WAIT
  );
}
