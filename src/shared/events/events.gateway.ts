import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { TestRun } from '@prisma/client';
import { BuildDto } from '../../builds/dto/build.dto';
import debounce from 'lodash.debounce';

@WebSocketGateway()
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  private testRuns: TestRun[] = [];

  buildCreated(build: BuildDto): void {
    this.server.emit('build_created', build);
  }

  buildFinished(build: BuildDto): void {
    this.server.emit('build_finished', build);
  }

  buildUpdated(build: BuildDto): void {
    this.server.emit('build_updated', build);
  }

  testRunCreated(testRun: TestRun): void {
    this.testRuns.push(testRun);
    debounce(
      () =>
        this.emitEvent('testRun_created', this.testRuns, () => {
          this.testRuns = [];
        }),
      3000,
      {
        maxWait: 5000,
      }
    )();
    // this.server.emit('testRun_created', testRun);
  }

  testRunUpdated(testRun: TestRun): void {
    this.server.emit('testRun_updated', testRun);
  }

  testRunDeleted(testRun: TestRun): void {
    this.server.emit('testRun_deleted', testRun);
  }

  private emitEvent(event: string, object: object, callbackfn: () => void) {
    console.log(object)
    this.server.emit(event, object);
    callbackfn();
  }
}
