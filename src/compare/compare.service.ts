import { ImageComparison, Project, TestStatus } from '@prisma/client';
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
import { StaticService } from '../static/static.service';
import { Dinov2Service } from './libs/dinov2/dinov2.service';
import { messageOf } from '../utils/errors';

@Injectable()
export class CompareService {
  private readonly logger: Logger = new Logger(CompareService.name);
  private warnedNoDinov2 = false;

  constructor(
    private readonly pixelmatchService: PixelmatchService,
    private readonly lookSameService: LookSameService,
    private readonly odiffService: OdiffService,
    private readonly vlmService: VlmService,
    private readonly prismaService: PrismaService,
    private readonly diffWorkerPool: DiffWorkerPool,
    private readonly staticService: StaticService,
    private readonly dinov2Service: Dinov2Service
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
    const { ignoreRenderingNoise, comparatorConfig } = splitRenderingNoiseConfig(
      comparator.parseConfig(project.imageComparisonConfig)
    );
    const filtering = ignoreRenderingNoise && this.dinov2Service.isConfigured();
    if (ignoreRenderingNoise && !filtering && !this.warnedNoDinov2) {
      this.warnedNoDinov2 = true;
      this.logger.warn('ignoreRenderingNoise is on but DINOV2_URL is not set: the filter is off');
    }
    if (!filtering) {
      return comparator.getDiff(data, comparatorConfig);
    }
    if (comparator.appliesRenderingNoiseFilter) {
      return comparator.getDiff({ ...data, ignoreRenderingNoise: true }, comparatorConfig);
    }

    const result = await comparator.getDiff(data, comparatorConfig);
    return this.filterRenderingNoise(data, result);
  }

  private async filterRenderingNoise(data: ImageCompareInput, result: DiffResult): Promise<DiffResult> {
    if (result.status !== TestStatus.unresolved || !result.isSameDimension) {
      return result;
    }
    try {
      const [baseline, image] = await Promise.all([
        this.staticService.getImageBuffer(data.baseline),
        data.imageBuffer ?? this.staticService.getImageBuffer(data.image),
      ]);
      if (!baseline || !image) {
        return result;
      }
      const { measure, gate } = await this.diffWorkerPool.run({
        kind: 'blur-amplitude',
        baseline,
        image,
        ignoreAreas: data.ignoreAreas,
      });
      if (!measure || !gate) {
        return result;
      }
      if (!(await this.dinov2Service.confirmsNoiseForGate(gate, baseline, image)).noise) {
        return result;
      }
      this.logger.debug(
        `Diff of ${result.diffPercent}% passed as rendering noise (blur amplitude ${measure.amplitude.toFixed(1)}, ${measure.solidPixels} solid pixels)`
      );
      if (result.diffName) {
        void this.staticService.deleteImage(result.diffName);
      }
      return { ...result, status: TestStatus.ok, diffName: null };
    } catch (error) {
      this.logger.warn(`Rendering-noise filter skipped: ${messageOf(error)}`);
      return result;
    }
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
