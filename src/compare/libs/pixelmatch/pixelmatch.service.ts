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

export const DEFAULT_CONFIG: PixelmatchConfig = { threshold: 0.1, ignoreAntialiasing: true };

@Injectable()
export class PixelmatchService implements ImageComparator {
  private readonly logger: Logger = new Logger(PixelmatchService.name);

  constructor(
    private readonly staticService: StaticService,
    private readonly diffWorkerPool: DiffWorkerPool
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
    };

    if (result.diffPercent > data.diffTollerancePercent) {
      if (output.diffBuffer) {
        result.diffName = await this.staticService.saveImage('diff', Buffer.from(output.diffBuffer));
      }
      result.status = TestStatus.unresolved;
    } else {
      result.status = TestStatus.ok;
    }
    return result;
  }
}
