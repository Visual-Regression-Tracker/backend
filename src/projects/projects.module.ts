import { forwardRef, HttpModule, Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { BuildsModule } from '../builds/builds.module';
import { TestVariationsModule } from '../test-variations/test-variations.module';
import { PrismaService } from '../prisma/prisma.service';
import { VRTUserLogService } from '../shared/user-logs/user-log.service';

@Module({
  imports: [forwardRef(() => BuildsModule), forwardRef(() => TestVariationsModule), HttpModule],
  providers: [ProjectsService, PrismaService, VRTUserLogService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule { }
