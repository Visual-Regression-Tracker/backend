import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { TestRun } from '@prisma/client';
import { BuildDto } from '../../builds/dto/build.dto';

@WebSocketGateway()
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  buildCreated(build: BuildDto): void {
    this.server.emit('build_created', build);
  }

  buildFinished(build: BuildDto): void {
    this.server.emit('build_finished', build);
  }

  buildUpdated(build: BuildDto): void {
    this.server.emit('build_updated', build);
  }

  newTestRun(testRun: TestRun): void {
    this.server.emit('testRun_created', testRun);
  }

  
  testRunDeleted(testRun: TestRun): void {
    this.server.emit('testRun_deleted', testRun);
  }
}
