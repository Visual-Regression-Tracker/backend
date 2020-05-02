import { Injectable } from '@nestjs/common';
import { CreateTestRequestDto } from 'src/test/dto/create-test-request.dto';
import { IgnoreAreaDto } from 'src/test/dto/ignore-area.dto';
import { TestRunsService } from 'src/test-runs/test-runs.service';
import { StaticService } from 'src/shared/static/static.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TestVariation } from '@prisma/client';
import { TestVariationDto } from 'src/test/dto/test-variation.dto';

@Injectable()
export class TestVariationsService {
  constructor(
    private testRunsService: TestRunsService,
    private staticService: StaticService,
    private prismaService: PrismaService,
  ) {}

  async findOrCreate(createTestDto: CreateTestRequestDto): Promise<TestVariation> {
    const data = {
      name: createTestDto.name,
      os: createTestDto.os ? createTestDto.os : null,
      browser: createTestDto.browser ? createTestDto.browser : null,
      viewport: createTestDto.viewport ? createTestDto.viewport : null,
      device: createTestDto.device ? createTestDto.device : null,
    };
    let [testVariation] = await this.prismaService.testVariation.findMany({
      where: {
        projectId: createTestDto.projectId,
        ...data,
      },
    });

    if (!testVariation) {
      testVariation = await this.prismaService.testVariation.create({
        data: {
          project: { connect: { id: createTestDto.projectId } },
          ...data,
        },
      });
    }

    return testVariation;
  }

  async updateIgnoreAreas(id: string, ignoreAreas: IgnoreAreaDto[]): Promise<TestVariation> {
    return this.prismaService.testVariation
      .update({
        where: { id },
        data: {
          ignoreAreas: JSON.stringify(ignoreAreas),
        },
      });
  }

  async remove(id: string): Promise<TestVariation> {
    const testVariation = await this.prismaService.testVariation.findOne({
      where: { id },
      include: {
        testRuns: true,
      },
    });

    try {
      await Promise.all(
        testVariation.testRuns.map(testRun => this.testRunsService.delete(testRun.id)),
      );
      if (testVariation.baselineName) this.staticService.deleteImage(testVariation.baselineName);
    } catch (err) {
      console.log(err);
    }

    return this.prismaService.testVariation.delete({
      where: { id },
    });
  }
}
