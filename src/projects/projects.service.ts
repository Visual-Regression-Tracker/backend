import { Injectable } from '@nestjs/common';
import { CreateProjectDto } from './dto/create-project.dto';
import { BuildsService } from '../builds/builds.service';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { PrismaService } from '../prisma/prisma.service';
import { Project } from '@prisma/client';

@Injectable()
export class ProjectsService {
  constructor(
    private prismaService: PrismaService,
    private buildsService: BuildsService,
    private testVariationsService: TestVariationsService,
  ) {
    // create default project if there are none in DB
    this.findAll().then(projects => {
      if (projects.length === 0) {
        this.create({
          name: 'Default project'
        }).then(project => {
          console.log('##############################');
          console.log('## CREATING DEFAULT PROJECT ##');
          console.log('##############################');
          console.log('');
          console.log(`Project name ${project.name}`);
          console.log(`Project key: ${project.id}`);
        })
      }
    })
  }

  async findAll(): Promise<Project[]> {
    return this.prismaService.project.findMany();
  }

  async create(createProjectDto: CreateProjectDto): Promise<Project> {
    return this.prismaService.project.create({
      data: {
        name: createProjectDto.name,
      },
    });
  }

  async remove(id: string): Promise<Project> {
    const project = await this.prismaService.project.findOne({
      where: { id },
      include: {
        builds: true,
        testVariations: true,
      },
    });

    try {
      await Promise.all(project.builds.map(build => this.buildsService.remove(build.id)));
      await Promise.all(
        project.testVariations.map(testVariation =>
          this.testVariationsService.remove(testVariation.id),
        ),
      );
    } catch (err) {
      console.log(err);
    }

    return this.prismaService.project.delete({
      where: { id },
    });
  }
}
