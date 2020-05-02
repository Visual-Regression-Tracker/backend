import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SequelizeModule } from '@nestjs/sequelize';
import { SharedModule } from './shared/shared.module';
import { ConfigService } from './shared/config/config.service';
import { BuildsModule } from './builds/builds.module';
import { ProjectsModule } from './projects/projects.module';
import { TestRunsModule } from './test-runs/test-runs.module';
import { TestVariationsModule } from './test-variations/test-variations.module';
import { TestModule } from './test/test.module';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    // SequelizeModule.forRootAsync({
    //   imports: [SharedModule],
    //   useFactory: (configService: ConfigService) => configService.dbConfig,
    //   inject: [ConfigService],
    // }),
    BuildsModule,
    ProjectsModule,
    TestRunsModule,
    TestVariationsModule,
    TestModule,
  ],
  controllers: [AppController],
  providers: [PrismaService],
})
export class AppModule {}
