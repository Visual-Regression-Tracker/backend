import { ImageComparison, Project } from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_CONFIG, PixelmatchService } from './libs/pixelmatch/pixelmatch.service';
import { ImageComparator } from './libs/image-comparator.interface';
import { ImageCompareInput } from './libs/ImageCompareInput';
import { PrismaService } from '../prisma/prisma.service';
import { DiffResult, SignatureConfig } from '../test-runs/diffResult';
import { parseConfig } from './utils';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { OdiffService } from './libs/odiff/odiff.service';
import { VlmService } from './libs/vlm/vlm.service';
import { isHddStaticServiceConfigured } from '../static/utils';
import { DiffWorkerPool } from './diff-worker-pool';
import { SignatureJobInput, SignatureJobOutput } from './libs/pixelmatch/signature.core';
import { hasRenderingNoiseFlag, withoutRenderingNoiseFlag } from './libs/rendering-noise.config';

@Injectable()
export class CompareService {
  private readonly logger: Logger = new Logger(CompareService.name);
  private warnedAboutRemovedFlag = false;

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
    const config = comparator.parseConfig(project.imageComparisonConfig);
    this.warnAboutRemovedFlag(config);
    return comparator.getDiff(data, withoutRenderingNoiseFlag(config));
  }

  private warnAboutRemovedFlag(config: object): void {
    if (!this.warnedAboutRemovedFlag && hasRenderingNoiseFlag(config)) {
      this.warnedAboutRemovedFlag = true;
      this.logger.warn('The ignoreRenderingNoise project setting was removed in 6.0; comparisons run without it.');
    }
  }

  getSignatureConfig(project: Project): SignatureConfig {
    const { threshold, ignoreAntialiasing } = parseConfig(project.imageComparisonConfig, DEFAULT_CONFIG, this.logger);
    return { threshold, includeAA: ignoreAntialiasing };
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
