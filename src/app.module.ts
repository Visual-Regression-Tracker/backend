import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SequelizeModule } from '@nestjs/sequelize';
import { SharedModule } from './shared/shared.module';
import { ConfigService } from './shared/config/config.service';
import { BuildsModule } from './builds/builds.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    SequelizeModule.forRootAsync({
      imports: [SharedModule],
      useFactory: (configService: ConfigService) => configService.dbConfig,
      inject: [ConfigService],
    }),
    BuildsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
