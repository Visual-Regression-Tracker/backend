import { Module } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { BuildsController } from './builds.controller';
import { UsersModule } from '../users/users.module';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [SharedModule, UsersModule, TestRunsModule],
  providers: [BuildsService, PrismaService],
  controllers: [BuildsController],
  exports: [BuildsService],
})
export class BuildsModule {}
