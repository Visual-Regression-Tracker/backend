import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { StaticService } from '../../../static/static.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { parseConfig } from '../../utils';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { PixelmatchConfig } from './pixelmatch.types';
import { DiffWorkerPool } from '../../diff-worker-pool';
import { Dinov2Service } from '../dinov2/dinov2.service';

export const DEFAULT_CONFIG: PixelmatchConfig = { threshold: 0.1, ignoreAntialiasing: true };

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
    const imageBuffer = await this.staticService.getImageBuffer(data.image);
    if (!imageBuffer) {
      throw new Error(`Cannot get image: ${data.image}`);
    }

    // decode + pixelmatch + diff encode run off the event loop
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
      // Asked for on every comparison, not only when the project has bulk
      // approve of variations switched on: the pass costs little beside the
      // full-size diff that has already been paid for, and computing it lazily
      // would leave every run ingested before the flag was turned on without
      // one — which is exactly the build someone then tries to review.
      withSignature: true,
      // Only when the caller is keeping the diff. shouldAutoApprove compares
      // against past baselines with this off and throws the result away —
      // making thumbnails for those would burn the CPU and, worse, store two
      // objects per attempt that nothing ever references or deletes.
      withThumbnails: data.saveDiffAsFile,
      // measured here, next to the diff, while the images are decoded anyway
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

    // The mismatch stays on the run as measured, so a reviewer can still see
    // the pixels moved; only the verdict is the filter's.
    if (output.renderingNoiseOnly && (await this.confirmedByDinov2(data, baselineBuffer, imageBuffer))) {
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
      // Kept to the same condition as the diff itself: a thumbnail of a diff
      // that was never saved would point at a file that does not exist. Stored
      // as ordinary images so they follow the same storage, the same deletion
      // and the same URLs as everything else, with no naming convention for
      // the UI to guess at.
      // tied to the diff actually landing, not merely to being over tolerance
      if (result.diffName && output.imageThumbnail && output.diffThumbnail) {
        const [imageThumbnailName, diffThumbnailName] = await Promise.all([
          this.staticService.saveImage('screenshot', Buffer.from(output.imageThumbnail)),
          this.staticService.saveImage('diff', Buffer.from(output.diffThumbnail)),
        ]);
        // only when both came back: a result carrying one half of a pair, or a
        // key set to undefined, is worse than none at all
        if (imageThumbnailName && diffThumbnailName) {
          result.imageThumbnailName = imageThumbnailName;
          result.diffThumbnailName = diffThumbnailName;
        }
      }
      result.status = TestStatus.unresolved;
    } else {
      result.status = TestStatus.ok;
    }
    return result;
  }

  // The project's DINOv2 check, when it has one, gets the last word on what the
  // blur would pass; without one the blur's verdict stands.
  private async confirmedByDinov2(data: ImageCompareInput, baseline: Buffer, image: Buffer): Promise<boolean> {
    const dinov2 = data.blurAmplitude?.dinov2;
    if (!dinov2) {
      return true;
    }
    const verdict = await this.dinov2Service.confirmsNoise(baseline, image, data.ignoreAreas, dinov2.threshold);
    if (!verdict.noise) {
      this.logger.debug(`DINOv2 sees a change of content (score ${verdict.score?.toFixed(3) ?? 'n/a'}): to review`);
    }
    return verdict.noise;
  }
}
