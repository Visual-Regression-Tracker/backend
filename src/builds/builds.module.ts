import { Module } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { BuildsController } from './builds.controller';
import { UsersModule } from 'src/users/users.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { TestRunsModule } from 'src/test-runs/test-runs.module';

@Module({
  imports: [UsersModule, TestRunsModule],
  providers: [BuildsService, PrismaService],
  controllers: [BuildsController],
  exports: [BuildsService],
})
export class BuildsModule {}
