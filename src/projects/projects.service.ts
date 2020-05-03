import { Injectable } from '@nestjs/common';
import { CreateProjectDto } from './dto/create-project.dto';
import { BuildsService } from 'src/builds/builds.service';
import { TestVariationsService } from 'src/test-variations/test-variations.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { Project, Build, TestVariation } from '@prisma/client';

@Injectable()
export class ProjectsService {
  constructor(
    private prismaService: PrismaService,
    private buildsService: BuildsService,
    private testVariationsService: TestVariationsService,
  ) { }

  async findAll(): Promise<Project[]> {
    return this.prismaService.project.findMany();
  }

  async findOneById(id: string): Promise<Project & {
    builds: Build[];
    testVariations: TestVariation[];
  }> {
    return this.prismaService.project.findOne({
      where: { id },
      include: {
        builds: true,
        testVariations: true,
      },
      // order: [['builds', 'createdAt', 'DESC']],
    });
  }

  async create(createProjectDto: CreateProjectDto): Promise<Project> {
    return this.prismaService.project.create({
      data: {
        name: createProjectDto.name,
      },
    });
  }

  async remove(id: string): Promise<Project> {
    const project = await this.findOneById(id);

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

    return this.prismaService.project.delete({
      where: { id },
    });
  }
}
