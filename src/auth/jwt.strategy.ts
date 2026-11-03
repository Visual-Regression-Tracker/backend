import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { User } from '@prisma/client';
import { JwtPayload } from './jwt-payload.model';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prismaService: PrismaService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // @nestjs/passport calls `done` with whatever this returns, so it must not call `done` itself
  async validate(payload: JwtPayload): Promise<User> {
    const user =
      typeof payload.sub === 'string' && payload.sub
        ? await this.prismaService.user.findUnique({ where: { id: payload.sub } })
        : null;
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
