import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { User } from '@prisma/client';
import { JwtPayload } from './jwt-payload.model';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly acceptEmailOnlyTokens: boolean;

  constructor(
    configService: ConfigService,
    private prismaService: PrismaService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
    // tokens issued before `sub` existed carry only the email; drop them once they have all expired
    this.acceptEmailOnlyTokens =
      String(configService.get('JWT_LEGACY_EMAIL_TOKENS') ?? 'true')
        .trim()
        .toLowerCase() !== 'false';
  }

  // @nestjs/passport calls `done` with whatever this returns, so it must not call `done` itself
  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.findUser(payload);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }

  private findUser(payload: JwtPayload): Promise<User | null> {
    if (typeof payload.sub === 'string' && payload.sub) {
      return this.prismaService.user.findUnique({ where: { id: payload.sub } });
    }
    if (this.acceptEmailOnlyTokens && typeof payload.email === 'string' && payload.email) {
      return this.prismaService.user.findUnique({ where: { email: payload.email } });
    }
    return Promise.resolve(null);
  }
}
