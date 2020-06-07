import {
  SubscribeMessage,
  WebSocketGateway,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  WsResponse,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { TestRun } from '@prisma/client';
import { BuildDto } from 'src/builds/dto/build.dto';

@WebSocketGateway(4201)
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  buildCreated(build: BuildDto) {
    this.server.emit('build_created', build);
  }

  buildUpdated(build: BuildDto) {
    this.server.emit('build_updated', build);
  }

  newTestRun(testRun: TestRun) {
    this.server.emit('testRun_created', testRun);
  }
}
