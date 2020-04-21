import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { ConfigService } from 'src/shared/config/config.service';
import { SharedModule } from 'src/shared/shared.module';
import { ApiGuard } from './guards/api.guard';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [SharedModule],
      useFactory: async (configService: ConfigService) =>
        configService.jwtConfig,
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtStrategy, ApiGuard],
  exports: [AuthService],
})
export class AuthModule {}
