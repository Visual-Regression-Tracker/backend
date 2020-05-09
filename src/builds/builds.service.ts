import { Injectable } from '@nestjs/common';
import { CreateBuildDto } from './dto/build-create.dto';
import { TestService } from 'src/test/test.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { Build, TestRun, TestVariation } from '@prisma/client';

@Injectable()
export class BuildsService {
  constructor(
    private prismaService: PrismaService,
    private testService: TestService
  ) { }

  async findById(id: string): Promise<(TestRun & { testVariation: TestVariation; })[]> {
    return this.testService.getTestRunsByBuildId(id);
  }

  async findMany(projectId: string): Promise<Build[]> {
    return this.prismaService.build.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' }
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
    const testRuns = await this.findById(id);

    try {
      await Promise.all(
        testRuns.map((testRun) => this.testService.deleteTestRun(testRun.id))
      );
    } catch (err) {
      console.log(err);
    }

    return this.prismaService.build.delete({
      where: { id },
    });
  }
}
