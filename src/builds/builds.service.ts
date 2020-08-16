import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CreateBuildDto } from './dto/build-create.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Build, Project } from '@prisma/client';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { BuildDto } from './dto/build.dto';
import uuidAPIKey from 'uuid-apikey';

@Injectable()
export class BuildsService {
  constructor(
    private prismaService: PrismaService,
    private testRunsService: TestRunsService,
    private eventsGateway: EventsGateway
  ) {}

  async findMany(projectId: string): Promise<BuildDto[]> {
    const buildList = await this.prismaService.build.findMany({
      where: { projectId },
      include: {
        testRuns: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return buildList.map((build) => new BuildDto(build));
  }

  async create(createBuildDto: CreateBuildDto): Promise<BuildDto> {
    let project: Project;

    if (uuidAPIKey.isUUID(createBuildDto.project)) {
      project = await this.prismaService.project.findOne({
        where: { id: createBuildDto.project },
      });
    } else {
      project = await this.prismaService.project.findOne({
        where: {
          name: createBuildDto.project,
        },
      });
    }

    if (!project) {
      throw new HttpException(`Project not found`, HttpStatus.NOT_FOUND);
    }

    const build = await this.prismaService.build.create({
      data: {
        branchName: createBuildDto.branchName,
        isRunning: true,
        project: {
          connect: {
            id: project.id,
          },
        },
      },
    });
    const buildDto = new BuildDto(build);
    this.eventsGateway.buildCreated(buildDto);
    return buildDto;
  }

  async stop(id: string): Promise<BuildDto> {
    const build = await this.prismaService.build.update({
      where: { id },
      include: {
        testRuns: true,
      },
      data: {
        isRunning: false,
      },
    });
    const buildDto = new BuildDto(build);
    this.eventsGateway.buildFinished(buildDto);
    return buildDto;
  }

  async remove(id: string): Promise<Build> {
    const build = await this.prismaService.build.findOne({
      where: { id },
      include: {
        testRuns: true,
      },
    });

    await Promise.all(build.testRuns.map((testRun) => this.testRunsService.delete(testRun.id)));

    return this.prismaService.build.delete({
      where: { id },
    });
  }
}
