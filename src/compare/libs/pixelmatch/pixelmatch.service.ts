import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { StaticService } from '../../../static/static.service';
import { isByteEqualWellFormedPng, readPngDimensions } from '../../../static/utils';
import { DiffResult } from '../../../test-runs/diffResult';
import { parseConfig } from '../../utils';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { PixelmatchConfig } from './pixelmatch.types';
import { PixelmatchJobOutput } from './pixelmatch.core';
import { DiffWorkerPool } from '../../diff-worker-pool';
import { Dinov2Service } from '../dinov2/dinov2.service';

export const DEFAULT_CONFIG: PixelmatchConfig = { threshold: 0.1, ignoreAntialiasing: true };

function sameDimensions(a: Buffer, b: Buffer): boolean {
  const x = readPngDimensions(a);
  const y = readPngDimensions(b);
  return !x || !y || (x.width === y.width && x.height === y.height);
}

@Injectable()
export class PixelmatchService implements ImageComparator {
  private readonly logger: Logger = new Logger(PixelmatchService.name);
  readonly appliesBlurAmplitudeFilter = true;

  constructor(
    private readonly staticService: StaticService,
    private readonly diffWorkerPool: DiffWorkerPool,
    private readonly dinov2Service: Dinov2Service
  ) {}

  parseConfig(configJson: string): PixelmatchConfig {
    return parseConfig(configJson, DEFAULT_CONFIG, this.logger);
  }

  async getDiff(data: ImageCompareInput, config: PixelmatchConfig): Promise<DiffResult> {
    const baselineBuffer = await this.staticService.getImageBuffer(data.baseline);
    if (!baselineBuffer) {
      return NO_BASELINE_RESULT;
    }
    const imageBuffer = data.imageBuffer ?? (await this.staticService.getImageBuffer(data.image));
    if (!imageBuffer) {
      throw new Error(`Cannot get image: ${data.image}`);
    }

    if (isByteEqualWellFormedPng(baselineBuffer, imageBuffer)) {
      return EQUAL_RESULT;
    }

    if (!config.allowDiffDimensions && !sameDimensions(baselineBuffer, imageBuffer)) {
      return DIFF_DIMENSION_RESULT;
    }

    const output = await this.diffWorkerPool.run({
      kind: 'diff',
      baseline: baselineBuffer,
      image: imageBuffer,
      ignoreAreas: data.ignoreAreas,
      threshold: config.threshold,
      includeAA: config.ignoreAntialiasing,
      allowDiffDimensions: config.allowDiffDimensions,
      diffTolerancePercent: data.diffTollerancePercent,
      saveDiff: data.saveDiffAsFile,
      ...(data.blurAmplitude ? { blurAmplitude: data.blurAmplitude } : {}),
    });

    if (output.equal) {
      return EQUAL_RESULT;
    }
    if (!output.isSameDimension && !config.allowDiffDimensions) {
      return DIFF_DIMENSION_RESULT;
    }

    const result: DiffResult = {
      ...NO_BASELINE_RESULT,
      isSameDimension: output.isSameDimension,
      pixelMisMatchCount: output.pixelMisMatchCount,
      diffPercent: output.diffPercent,
      ...(output.signature
        ? {
            changeSignature: {
              threshold: config.threshold,
              includeAA: config.ignoreAntialiasing,
              signature: output.signature,
            },
          }
        : {}),
    };

    if (output.renderingNoiseOnly && (await this.confirmedByDinov2(data, baselineBuffer, imageBuffer, output))) {
      this.logger.debug(
        `Diff of ${result.diffPercent}% passed as rendering noise (blur amplitude ${output.blurAmplitude?.toFixed(1)}, ${output.solidPixels} solid pixels)`
      );
      result.status = TestStatus.ok;
      return result;
    }

    if (result.diffPercent! > data.diffTollerancePercent) {
      if (output.diffBuffer) {
        result.diffName = await this.staticService.saveImage('diff', Buffer.from(output.diffBuffer));
      }
      if (result.diffName) {
        Object.assign(result, await this.saveThumbnails(output));
      }
      result.status = TestStatus.unresolved;
    } else {
      result.status = TestStatus.ok;
    }
    return result;
  }

  private async confirmedByDinov2(
    data: ImageCompareInput,
    baseline: Buffer,
    image: Buffer,
    output: PixelmatchJobOutput
  ): Promise<boolean> {
    const dinov2 = data.blurAmplitude?.dinov2;
    if (!dinov2) {
      return true;
    }
    if (!output.gate) {
      return false;
    }
    const verdict = await this.dinov2Service.confirmsNoiseForGate(output.gate, baseline, image, dinov2.threshold);
    if (!verdict.noise) {
      this.logger.debug(`DINOv2 sees a change of content (score ${verdict.score?.toFixed(3) ?? 'n/a'}): to review`);
    }
    return verdict.noise;
  }

  private async saveThumbnails(
    output: PixelmatchJobOutput
  ): Promise<{ imageThumbnailName?: string; diffThumbnailName?: string }> {
    if (!output.imageThumbnail || !output.diffThumbnail) {
      return {};
    }
    const [image, diff] = await Promise.allSettled([
      this.staticService.saveImage('screenshot', Buffer.from(output.imageThumbnail)),
      this.staticService.saveImage('diff', Buffer.from(output.diffThumbnail)),
    ]);
    if (image.status === 'fulfilled' && diff.status === 'fulfilled' && image.value && diff.value) {
      return { imageThumbnailName: image.value, diffThumbnailName: diff.value };
    }
    for (const saved of [image, diff]) {
      if (saved.status === 'fulfilled' && saved.value) void this.staticService.deleteImage(saved.value);
    }
    const failure = [image, diff].find((saved) => saved.status === 'rejected');
    this.logger.warn(`Thumbnails not saved: ${failure?.reason?.message ?? 'empty name'}`);
    return {};
  }
}
