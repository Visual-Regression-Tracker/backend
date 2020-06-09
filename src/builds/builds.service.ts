import { Injectable } from '@nestjs/common';
import { CreateBuildDto } from './dto/build-create.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Build } from '@prisma/client';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../events/events.gateway';
import { BuildDto } from './dto/build.dto';

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

    return buildList.map(build => new BuildDto(build));
  }

  async create(createBuildDto: CreateBuildDto): Promise<BuildDto> {
    const build = await this.prismaService.build.create({
      data: {
        branchName: createBuildDto.branchName,
        project: {
          connect: {
            id: createBuildDto.projectId,
          },
        },
      },
      include: {
        testRuns: true,
      },
    });
    const buildDto = new BuildDto(build);
    this.eventsGateway.buildCreated(buildDto);
    return buildDto;
  }

  async remove(id: string): Promise<Build> {
    const build = await this.prismaService.build.findOne({
      where: { id },
      include: {
        testRuns: true,
      },
    });

    try {
      await Promise.all(build.testRuns.map(testRun => this.testRunsService.delete(testRun.id)));
    } catch (err) {
      console.log(err);
    }

    return this.prismaService.build.delete({
      where: { id },
    });
  }
}
