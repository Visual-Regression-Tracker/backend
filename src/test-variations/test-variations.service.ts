import { Injectable } from '@nestjs/common';
import { CreateTestRequestDto } from '../test/dto/create-test-request.dto';
import { IgnoreAreaDto } from '../test/dto/ignore-area.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TestVariation } from '@prisma/client';

@Injectable()
export class TestVariationsService {
  constructor(
    private prismaService: PrismaService,
  ) { }

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
    return this.prismaService.testVariation.delete({
      where: { id },
    });
  }
}
