import { ImageComparison, Project } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PixelmatchService } from './libs/pixelmatch/pixelmatch.service';
import { ImageComparator } from './libs/image-comparator.interface';
import { ImageCompareInput } from './libs/ImageCompareInput';
import { PrismaService } from '../prisma/prisma.service';
import { DiffResult } from '../test-runs/diffResult';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { OdiffService } from './libs/odiff/odiff.service';

@Injectable()
export class CompareService {
  constructor(
    private pixelmatchService: PixelmatchService,
    private lookSameService: LookSameService,
    private odiffService: OdiffService,
    private prismaService: PrismaService
  ) {}

  async getDiff({ projectId, data }: { projectId: string; data: ImageCompareInput }): Promise<DiffResult> {
    const project: Project = await this.prismaService.project.findUnique({ where: { id: projectId } });
    const comparator = this.getComparator(project.imageComparison);
    const config = comparator.parseConfig(project.imageComparisonConfig);
    return comparator.getDiff(data, config);
  }

  getComparator(imageComparison: ImageComparison): ImageComparator {
    switch (imageComparison) {
      case ImageComparison.pixelmatch: {
        return this.pixelmatchService;
      }
      case ImageComparison.lookSame: {
        return this.lookSameService;
      }
      case ImageComparison.odiff: {
        return this.odiffService;
      }
      default: {
        return this.pixelmatchService;
      }
    }
  }
}
