import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { TestRun } from '@prisma/client';
import { BuildDto } from '../../builds/dto/build.dto';
import { getBuildsStats } from '../../builds/build-stats';
import { TestRunDto } from '../../test-runs/dto/testRun.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { Debounced, debounce } from './debounce';

const DEBOUNCE_WAIT = 1500;
const MAX_WAIT = 3000;

const TEST_RUN_EVENTS = ['testRun_created', 'testRun_updated', 'testRun_deleted'] as const;
type TestRunEvent = (typeof TEST_RUN_EVENTS)[number];

@WebSocketGateway({ cors: true })
export class EventsGateway implements OnApplicationShutdown {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(private prismaService: PrismaService) {}

  private readonly testRunQueues = Object.fromEntries(
    TEST_RUN_EVENTS.map((event) => [event, new Map<string, TestRunDto>()])
  ) as Record<TestRunEvent, Map<string, TestRunDto>>;
  private readonly testRunEmitters = Object.fromEntries(
    TEST_RUN_EVENTS.map((event) => [event, debounce(() => this.emitQueued(event), DEBOUNCE_WAIT, MAX_WAIT)])
  ) as Record<TestRunEvent, Debounced>;
  private readonly buildsUpdatedQueued = new Set<string>();

  buildCreated(build: BuildDto): void {
    this.server.emit('build_created', build);
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
    this.enqueueTestRun(
      this.testRunQueues.testRun_created.has(testRun.id) ? 'testRun_created' : 'testRun_updated',
      testRun
    );
    this.buildUpdated(testRun.buildId);
  }

  testRunDeleted(testRun: TestRun): void {
    this.testRunQueues.testRun_created.delete(testRun.id);
    this.testRunQueues.testRun_updated.delete(testRun.id);
    this.enqueueTestRun('testRun_deleted', testRun);
    this.buildUpdated(testRun.buildId);
  }

  buildDeleted(buildDto: BuildDto) {
    this.server.emit('build_deleted', buildDto);
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
    this.server.emit(event, testRuns);
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
          this.server.emit(
            'build_updated',
            builds.map((build) => new BuildDto(build, stats.get(build.id)))
          );
        })
        .catch((error) => this.logger.error(`Cannot emit build_updated: ${error}`));
    },
    DEBOUNCE_WAIT,
    MAX_WAIT
  );
}
