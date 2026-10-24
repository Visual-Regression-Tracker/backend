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
import { BlurAmplitudeOptions, isRenderingNoise } from './libs/pixelmatch/blur-amplitude.core';
import { splitBlurAmplitudeConfig } from './libs/blur-amplitude.config';
import { StaticService } from '../static/static.service';

@Injectable()
export class CompareService {
  private readonly logger: Logger = new Logger(CompareService.name);

  constructor(
    private readonly pixelmatchService: PixelmatchService,
    private readonly lookSameService: LookSameService,
    private readonly odiffService: OdiffService,
    private readonly vlmService: VlmService,
    private readonly prismaService: PrismaService,
    private readonly diffWorkerPool: DiffWorkerPool,
    private readonly staticService: StaticService
  ) {}

  async getDiff({ projectId, data }: { projectId: string; data: ImageCompareInput }): Promise<DiffResult> {
    const project: Project = (await this.prismaService.project.findUnique({ where: { id: projectId } }))!;
    const comparator = this.getComparator(project.imageComparison);
    // the rendering-noise filter is switched on in the library's config but is
    // applied here, for every library alike; the library gets the rest
    const { blurAmplitude, comparatorConfig } = splitBlurAmplitudeConfig(
      comparator.parseConfig(project.imageComparisonConfig),
      this.logger
    );
    if (!blurAmplitude) {
      return comparator.getDiff(data, comparatorConfig);
    }
    if (comparator.appliesBlurAmplitudeFilter) {
      return comparator.getDiff({ ...data, blurAmplitude }, comparatorConfig);
    }

    const result = await comparator.getDiff(data, comparatorConfig);
    return this.filterRenderingNoise(data, result, blurAmplitude);
  }

  /**
   * Overturns a failing verdict whose change, blurred, is no stronger than
   * anti-aliasing and sub-pixel rendering noise. The filter can only ever pass
   * a run, never fail one, so anything that keeps it from measuring — a missing
   * screenshot, a full queue, different sizes — leaves the verdict as it was.
   */
  private async filterRenderingNoise(
    data: ImageCompareInput,
    result: DiffResult,
    { sigma, threshold }: BlurAmplitudeOptions
  ): Promise<DiffResult> {
    // a size change is a finding of its own, and there is nothing to line up
    if (result.status !== TestStatus.unresolved || !result.isSameDimension) {
      return result;
    }
    try {
      const [baseline, image] = await Promise.all([
        this.staticService.getImageBuffer(data.baseline),
        this.staticService.getImageBuffer(data.image),
      ]);
      if (!baseline || !image) {
        return result;
      }
      const { measure } = await this.diffWorkerPool.run({
        kind: 'blur-amplitude',
        baseline,
        image,
        ignoreAreas: data.ignoreAreas,
        sigma,
      });
      if (!measure || !isRenderingNoise(measure, threshold)) {
        return result;
      }
      this.logger.debug(
        `Diff of ${result.diffPercent}% passed as rendering noise (blur amplitude ${measure.amplitude.toFixed(1)}, ${measure.solidPixels} solid pixels)`
      );
      // nothing will ever point at the diff of a run that passed
      if (result.diffName) {
        this.staticService.deleteImage(result.diffName);
      }
      return { ...result, status: TestStatus.ok, diffName: null };
    } catch (error) {
      // read as an Error, not checked with instanceof: fetch errors come from
      // another realm under Jest
      this.logger.warn(`Rendering-noise filter skipped: ${(error as Error)?.message ?? error}`);
      return result;
    }
  }

  /**
   * Position-independent signature of what changed between a baseline and a
   * screenshot, used to tell whether two screens carry the same change. Runs on
   * the diff worker pool: decoding a pair of full-size screenshots takes long
   * enough that doing it on the event loop stalls every other request.
   */
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
