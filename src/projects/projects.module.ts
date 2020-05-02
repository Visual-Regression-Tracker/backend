import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { BuildsModule } from 'src/builds/builds.module';
import { TestVariationsModule } from 'src/test-variations/test-variations.module';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  imports: [BuildsModule, TestVariationsModule],
  providers: [ProjectsService, PrismaService],
  controllers: [ProjectsController]
})
export class ProjectsModule {}
