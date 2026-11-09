import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { Socket } from 'socket.io';
import { JwtPayload } from './jwt-payload.model';
import { JwtStrategy } from './jwt.strategy';
import { userRoom } from '../shared/events/rooms';

export const SOCKET_UNAUTHORIZED = 'unauthorized';

// setTimeout fires at once for a longer delay
const MAX_TIMEOUT = 2 ** 31 - 1;

export type SocketMiddleware = (socket: Socket, next: (error?: Error) => void) => void;

@Injectable()
export class SocketAuthService {
  private readonly logger = new Logger(SocketAuthService.name);

  constructor(
    private jwtService: JwtService,
    private jwtStrategy: JwtStrategy
  ) {}

  middleware(): SocketMiddleware {
    return (socket, next) => {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error(SOCKET_UNAUTHORIZED));
      this.verify(token).then(
        (verified) => {
          if (!verified) return next(new Error(SOCKET_UNAUTHORIZED));
          void socket.join(userRoom(verified.user.id));
          this.closeAtExpiry(socket, verified.exp);
          next();
        },
        (error) => {
          this.logger.error(`Cannot check the token of socket ${socket.id}: ${error}`);
          next(new Error('Cannot check the token'));
        }
      );
    };
  }

  private closeAtExpiry(socket: Socket, exp: number | undefined): void {
    // socket.io drops a socket whose connection closed during the middleware without emitting 'disconnect'
    if (exp === undefined || socket.conn.readyState !== 'open') return;
    let timer: NodeJS.Timeout;
    const schedule = () => {
      const left = exp * 1000 - Date.now();
      timer = setTimeout(left > MAX_TIMEOUT ? schedule : () => socket.disconnect(true), Math.min(left, MAX_TIMEOUT));
    };
    schedule();
    socket.on('disconnect', () => clearTimeout(timer));
    socket.conn.once('close', () => clearTimeout(timer));
  }

  private async verify(token: string): Promise<{ user: User; exp?: number } | null> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      return null;
    }
    try {
      return { user: await this.jwtStrategy.validate(payload), exp: payload.exp };
    } catch (error) {
      if (error instanceof UnauthorizedException) return null;
      throw error;
    }
  }
}
