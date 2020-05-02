import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { Build } from 'src/builds/build.entity';
import { BuildsService } from 'src/builds/builds.service';
import { TestVariation } from 'src/test-variations/testVariation.entity';
import { TestVariationsService } from 'src/test-variations/test-variations.service';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project)
    private projectModel: typeof Project,
    private buildsService: BuildsService,
    private testVariationsService: TestVariationsService,
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
    const project = await this.projectModel.findOne({
      where: { id },
      include: [Build, TestVariation],
    });

    try {
      await Promise.all(
        project.testVariations.map(testVariation =>
          this.testVariationsService.remove(testVariation.id),
        ),
      );
      await Promise.all(project.builds.map(build => this.buildsService.remove(build.id)));
    } catch (err) {
      console.log(err);
    }

    return this.projectModel.destroy({
      where: { id },
    });
  }
}
