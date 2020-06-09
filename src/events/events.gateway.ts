import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { TestRun } from '@prisma/client';
import { BuildDto } from '../builds/dto/build.dto';

@WebSocketGateway(4201)
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  buildCreated(build: BuildDto) {
    this.server.emit('build_created', build);
  }

  newTestRun(testRun: TestRun) {
    this.server.emit('testRun_created', testRun);
  }
}