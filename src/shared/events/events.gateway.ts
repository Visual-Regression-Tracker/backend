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

  buildUpdated(build: BuildDto): void {
    this.server.emit('build_updated', build);
  }

  testRunCreated(testRun: TestRun): void {
    this.server.emit('testRun_created', testRun);
  }

  testRunUpdated(testRun: TestRun): void {
    this.server.emit('testRun_updated', testRun);
  }

  testRunDeleted(testRun: TestRun): void {
    this.server.emit('testRun_deleted', testRun);
  }
}
