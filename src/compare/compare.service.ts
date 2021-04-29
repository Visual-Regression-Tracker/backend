import { ImageComparison, Project } from '.prisma/client';
import { Injectable } from '@nestjs/common';
import { PixelmatchService } from './libs/pixelmatch.service';
import { ImageComparator, ImageCompareConfig, ImageCompareInput } from './libs/image-comparator.interface';
import { PrismaService } from '../prisma/prisma.service';
import { DiffResult } from '../test-runs/diffResult';

@Injectable()
export class CompareService {
  constructor(private pixelmatchService: PixelmatchService, private prismaService: PrismaService) {}

  async getDiff({ projectId, data }: { projectId: string; data: ImageCompareInput }): Promise<DiffResult> {
    const project: Project = await this.prismaService.project.findUnique({ where: { id: projectId } });
    return this.getComparator(project.imageComparison).getDiff(data, this.getConfig(project));
  }

  getComparator(imageComparison: ImageComparison): ImageComparator {
    switch (imageComparison) {
      case ImageComparison.pixelmatch: {
        return this.pixelmatchService;
      }
      default: {
        return this.pixelmatchService;
      }
    }
  }

  getConfig(project: Project): ImageCompareConfig {
    return {
      allowDiffDimensions: project.diffDimensionsFeature,
      ignoreAntialiasing: project.ignoreAntialiasing,
      threshold: project.threshold,
    };
  }
}
