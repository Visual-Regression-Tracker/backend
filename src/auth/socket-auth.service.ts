import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { Socket } from 'socket.io';
import { booleanFlag } from '../utils/env';
import { JwtPayload } from './jwt-payload.model';
import { JwtStrategy } from './jwt.strategy';

export const SOCKET_UNAUTHORIZED = 'unauthorized';

export type SocketMiddleware = (socket: Socket, next: (error?: Error) => void) => void;

@Injectable()
export class SocketAuthService {
  private readonly logger = new Logger(SocketAuthService.name);

  constructor(
    private jwtService: JwtService,
    private jwtStrategy: JwtStrategy,
    private configService: ConfigService
  ) {}

  middleware(): SocketMiddleware {
    const required = booleanFlag(this.configService.get('WS_AUTH_REQUIRED'), false);
    return (socket, next) => {
      const token: unknown = socket.handshake.auth?.token;
      if (token === undefined || token === null || token === '') {
        if (required) return next(new Error(SOCKET_UNAUTHORIZED));
        this.logger.warn(`Socket ${socket.id} connected without a token; set WS_AUTH_REQUIRED=true to refuse it`);
        return next();
      }
      this.findUser(token).then(
        (user) => next(user ? undefined : new Error(SOCKET_UNAUTHORIZED)),
        (error) => {
          this.logger.error(`Cannot check the token of socket ${socket.id}: ${error}`);
          next(new Error('Cannot check the token'));
        }
      );
    };
  }

  private async findUser(token: unknown): Promise<User | null> {
    if (typeof token !== 'string') return null;
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      return null;
    }
    try {
      return await this.jwtStrategy.validate(payload);
    } catch (error) {
      if (error instanceof UnauthorizedException) return null;
      throw error;
    }
  }
}
