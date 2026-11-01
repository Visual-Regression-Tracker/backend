import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { ApiGuard } from './guards/api.guard';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './guards/auth.guard';
import { SocketAuthService } from './socket-auth.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_LIFE_TIME'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtStrategy, ApiGuard, JwtAuthGuard, SocketAuthService],
  exports: [AuthService, ApiGuard, JwtAuthGuard, SocketAuthService],
})
export class AuthModule {}
