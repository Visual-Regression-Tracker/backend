import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { BuildsModule } from '../builds/builds.module';
import { TestVariationsModule } from '../test-variations/test-variations.module';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [BuildsModule, TestVariationsModule],
  providers: [ProjectsService, PrismaService],
  controllers: [ProjectsController]
})
export class ProjectsModule {}
