import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project)
    private projectModel: typeof Project,
  ) {}

  async findAll(): Promise<Project[]> {
    return this.projectModel.findAll();
  }

  async create(createProjectDto: CreateProjectDto): Promise<Project> {
      const project = new Project()
      project.name = createProjectDto.name;

    return project.save();
  }
}
