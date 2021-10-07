import { forwardRef, HttpModule, Module } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { BuildsController } from './builds.controller';
import { UsersModule } from '../users/users.module';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { VRTUserLogService } from 'src/shared/user-logs/user-log.service';

@Module({
  imports: [SharedModule, UsersModule, forwardRef(() => TestRunsModule), AuthModule, forwardRef(() => ProjectsModule), HttpModule],
  providers: [BuildsService, PrismaService, VRTUserLogService],
  controllers: [BuildsController],
  exports: [BuildsService],
})
export class BuildsModule { }
