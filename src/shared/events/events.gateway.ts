import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { TestRun } from '@prisma/client';
import { BuildDto } from '../../builds/dto/build.dto';

@WebSocketGateway()
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  buildCreated(build: BuildDto) {
    this.server.emit('build_created', build);
  }

  buildFinished(build: BuildDto) {
    this.server.emit('build_finished', build);
  }

  buildUpdated(build: BuildDto) {
    this.server.emit('build_updated', build);
  }

  newTestRun(testRun: TestRun) {
    this.server.emit('testRun_created', testRun);
  }
}
