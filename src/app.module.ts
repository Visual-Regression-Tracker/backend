import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { BuildsModule } from './builds/builds.module';
import { ProjectsModule } from './projects/projects.module';
import { TestRunsModule } from './test-runs/test-runs.module';
import { TestVariationsModule } from './test-variations/test-variations.module';
import { PrismaService } from './prisma/prisma.service';
import { DatabaseIndexesService } from './prisma/database-indexes.service';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { HttpExceptionFilter } from './http-exception.filter';
import { CompareModule } from './compare/compare.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    BuildsModule,
    ProjectsModule,
    TestRunsModule,
    TestVariationsModule,
    TerminusModule,
    CompareModule,
  ],
  providers: [
    AppService,
    PrismaService,
    DatabaseIndexesService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // No global response cache: it served a test run's state from before a write for a few
    // seconds (an ignore area saved, then read back without it).
  ],
  controllers: [HealthController],
})
export class AppModule {}
