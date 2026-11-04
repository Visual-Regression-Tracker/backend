import { ImageComparison, Project } from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { PixelmatchService } from './libs/pixelmatch/pixelmatch.service';
import { ImageComparator } from './libs/image-comparator.interface';
import { ImageCompareInput } from './libs/ImageCompareInput';
import { PrismaService } from '../prisma/prisma.service';
import { DiffResult } from '../test-runs/diffResult';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { OdiffService } from './libs/odiff/odiff.service';
import { VlmService } from './libs/vlm/vlm.service';
import { isHddStaticServiceConfigured } from '../static/utils';
import { DiffWorkerPool } from './diff-worker-pool';
import { SignatureJobInput, SignatureJobOutput } from './libs/pixelmatch/signature.core';
import { splitRenderingNoiseConfig } from './libs/rendering-noise.config';

@Injectable()
export class CompareService {
  private readonly logger: Logger = new Logger(CompareService.name);

  constructor(
    private readonly pixelmatchService: PixelmatchService,
    private readonly lookSameService: LookSameService,
    private readonly odiffService: OdiffService,
    private readonly vlmService: VlmService,
    private readonly prismaService: PrismaService,
    private readonly diffWorkerPool: DiffWorkerPool
  ) {}

  async getDiff({
    projectId,
    project: loadedProject,
    data,
  }: {
    projectId: string;
    project?: Project;
    data: ImageCompareInput;
  }): Promise<DiffResult> {
    const project: Project =
      loadedProject ?? (await this.prismaService.project.findUnique({ where: { id: projectId } }))!;
    const comparator = this.getComparator(project.imageComparison);
    const { comparatorConfig } = splitRenderingNoiseConfig(comparator.parseConfig(project.imageComparisonConfig));
    return comparator.getDiff(data, comparatorConfig);
  }

  async getChangeSignature(input: Omit<SignatureJobInput, 'kind'>): Promise<SignatureJobOutput> {
    return this.diffWorkerPool.run({ kind: 'signature', ...input });
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
        if (!isHddStaticServiceConfigured()) {
          throw new Error(
            'Odiff can only be used with HDD static service. Please use another image comparison lib in project settings or switch STATIC_SERVICE envitonmental variable to HDD.'
          );
        }

        return this.odiffService;
      }
      case ImageComparison.vlm: {
        return this.vlmService;
      }
      default: {
        this.logger.warn(`Unknown ImageComparison value: ${imageComparison}. Falling back to pixelmatch.`);
        return this.pixelmatchService;
      }
    }
  }
}
