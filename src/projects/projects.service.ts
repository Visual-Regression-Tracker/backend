import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { Build } from 'src/builds/build.entity';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project)
    private projectModel: typeof Project,
  ) {}

  async findAll(): Promise<Project[]> {
    return this.projectModel.findAll();
  }

  async findOneById(id: string): Promise<Project> {
    return this.projectModel.findOne({
      where: { id },
      include: [Build],
      order: [['builds', 'createdAt', 'DESC']],
    });
  }

  async create(createProjectDto: CreateProjectDto): Promise<Project> {
    const project = new Project();
    project.name = createProjectDto.name;

    return project.save();
  }

  async remove(id: string): Promise<number> {
    return this.projectModel.destroy({
      where: { id },
    });
  }
}
