import { Injectable } from '@nestjs/common';
import { IgnoreAreaDto } from '../test-runs/dto/ignore-area.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TestVariation, Baseline } from '@prisma/client';
import { StaticService } from '../shared/static/static.service';
import { CommentDto } from '../shared/dto/comment.dto';
import { BaselineDataDto } from '../shared/dto/baseline-data.dto';

@Injectable()
export class TestVariationsService {
  constructor(private prismaService: PrismaService, private staticService: StaticService) {}

  async getDetails(id: string): Promise<TestVariation & { baselines: Baseline[] }> {
    return this.prismaService.testVariation.findOne({
      where: { id },
      include: {
        baselines: {
          include: {
            testRun: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }

  async findOrCreate(projectId: string, baselineData: BaselineDataDto): Promise<TestVariation> {
    let [testVariation] = await this.prismaService.testVariation.findMany({
      where: {
        projectId,
        ...baselineData,
      },
    });

    if (!testVariation) {
      testVariation = await this.prismaService.testVariation.create({
        data: {
          project: { connect: { id: projectId } },
          ...baselineData,
        },
      });
    }

    return testVariation;
  }

  async updateIgnoreAreas(id: string, ignoreAreas: IgnoreAreaDto[]): Promise<TestVariation> {
    return this.prismaService.testVariation.update({
      where: { id },
      data: {
        ignoreAreas: JSON.stringify(ignoreAreas),
      },
    });
  }

  async updateComment(id: string, commentDto: CommentDto): Promise<TestVariation> {
    return this.prismaService.testVariation.update({
      where: { id },
      data: {
        comment: commentDto.comment,
      },
    });
  }

  async remove(id: string): Promise<TestVariation> {
    const variation = await this.getDetails(id);

    // clear history
    try {
      await Promise.all(
        variation.baselines.map(baseline =>
          Promise.all([
            this.staticService.deleteImage(baseline.baselineName),
            this.prismaService.baseline.delete({
              where: { id: baseline.id },
            }),
          ])
        )
      );
    } catch (err) {
      console.log(err);
    }

    return this.prismaService.testVariation.delete({
      where: { id },
    });
  }
}
