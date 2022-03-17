import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Build, TestRun } from '@prisma/client';
import { BuildDto } from '../../builds/dto/build.dto';
import { debounce } from 'lodash';
import { PrismaService } from '../../prisma/prisma.service';

@WebSocketGateway({ cors: true })
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  constructor(private prismaService: PrismaService) {}

  private debounceTimeout = 1500;
  private maxWait = 3000;
  private testRunsCreatedQueued: Array<TestRun> = [];
  private testRunsDeletedQueued: Array<TestRun> = [];
  private testRunsUpdatedQueued: Array<TestRun> = [];
  private buildsUpdatedQueued: Array<string> = [];

  buildCreated(build: BuildDto): void {
    this.server.emit('build_created', build);
  }

  buildUpdated(id: string): void {
    this.buildsUpdatedQueued.push(id);
    this.buildUpdatedDebounced();
  }

  testRunCreated(testRun: TestRun): void {
    this.testRunsCreatedQueued.push(testRun);
    this.testRunCreatedDebounced();
    this.buildUpdated(testRun.buildId);
  }

  testRunUpdated(testRun: TestRun): void {
    this.testRunsUpdatedQueued.push(testRun);
    this.testRunUpdatedDebounced();
    this.buildUpdated(testRun.buildId);
  }

  testRunDeleted(testRun: TestRun): void {
    this.testRunsCreatedQueued = this.testRunsCreatedQueued.filter((tr) => tr.id !== testRun.id);
    this.testRunsUpdatedQueued = this.testRunsUpdatedQueued.filter((tr) => tr.id !== testRun.id);
    this.testRunsDeletedQueued.push(testRun);
    this.testRunDeletedDebounced();
    this.buildUpdated(testRun.buildId);
  }

  buildDeleted(buildDto: BuildDto) {
    this.server.emit('build_deleted', buildDto);
  }

  private testRunUpdatedDebounced = debounce(
    () => {
      this.server.emit('testRun_updated', this.testRunsUpdatedQueued);
      this.testRunsUpdatedQueued = [];
    },
    this.debounceTimeout,
    {
      leading: true,
      maxWait: this.maxWait,
    }
  );

  private testRunCreatedDebounced = debounce(
    () => {
      this.server.emit('testRun_created', this.testRunsCreatedQueued);
      this.testRunsCreatedQueued = [];
    },
    this.debounceTimeout,
    {
      leading: true,
      maxWait: this.maxWait,
    }
  );

  private testRunDeletedDebounced = debounce(
    () => {
      this.server.emit('testRun_deleted', this.testRunsDeletedQueued);
      this.testRunsDeletedQueued = [];
    },
    this.debounceTimeout,
    {
      leading: true,
      maxWait: this.maxWait,
    }
  );

  private buildUpdatedDebounced = debounce(
    () => {
      this.prismaService.build
        .findMany({
          where: {
            id: {
              in: this.buildsUpdatedQueued,
            },
          },
          include: {
            testRuns: true,
          },
        })
        .then((builds: Array<Build>) => {
          this.server.emit(
            'build_updated',
            builds.map((build: Build) => new BuildDto(build))
          );
        });
      this.buildsUpdatedQueued = [];
    },
    this.debounceTimeout,
    {
      leading: true,
      maxWait: this.maxWait,
    }
  );
}
