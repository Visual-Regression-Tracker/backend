import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { Project } from './project.entity';
import { SequelizeModule } from '@nestjs/sequelize';
import { BuildsModule } from 'src/builds/builds.module';
import { TestVariationsModule } from 'src/test-variations/test-variations.module';

@Module({
  imports: [SequelizeModule.forFeature([Project]), BuildsModule, TestVariationsModule],
  providers: [ProjectsService],
  controllers: [ProjectsController]
})
export class ProjectsModule {}
