import { ExtractJwt, Strategy, VerifiedCallback } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { JwtPayload } from './jwt-payload.model';
import { UsersService } from 'src/users/users.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService, private usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload, done: VerifiedCallback) {
    const user = await this.usersService.getUserByEmail(payload.email);

    if (!user) {
      return done(new HttpException({}, HttpStatus.UNAUTHORIZED), false);
    }

    return done(null, user, payload.expire);
  }
}
