import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { Project } from './project.entity';
import { SequelizeModule } from '@nestjs/sequelize';
import { Build } from 'src/builds/build.entity';

@Module({
  imports: [SequelizeModule.forFeature([Project])],
  providers: [ProjectsService],
  controllers: [ProjectsController]
})
export class ProjectsModule {}
