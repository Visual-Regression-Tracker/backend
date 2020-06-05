import { Injectable } from '@nestjs/common';
import { CreateBuildDto } from './dto/build-create.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Build } from '@prisma/client';
import { TestRunsService } from '../test-runs/test-runs.service';

@Injectable()
export class BuildsService {
  constructor(private prismaService: PrismaService, private testRunsService: TestRunsService) {}

  async findMany(projectId: string): Promise<Build[]> {
    return this.prismaService.build.findMany({
      where: { projectId },
      include: {
        testRuns: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(buildDto: CreateBuildDto): Promise<Build> {
    return this.prismaService.build.create({
      data: {
        branchName: buildDto.branchName,
        project: {
          connect: {
            id: buildDto.projectId,
          },
        },
      },
    });
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
