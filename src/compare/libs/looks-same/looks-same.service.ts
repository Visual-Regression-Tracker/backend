import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { StaticService } from '../../../static/static.service';
import { asBuffer, isByteEqualWellFormedPng } from '../../../static/utils';
import { DiffResult } from '../../../test-runs/diffResult';
import { parseConfig } from '../../utils';
import { DiffWorkerPool } from '../../diff-worker-pool';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { LooksSameConfig } from './looks-same.types';
import { LOOKS_SAME_DEFAULT_CONFIG } from './looks-same.core';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';

export const DEFAULT_CONFIG = LOOKS_SAME_DEFAULT_CONFIG;

@Injectable()
export class LookSameService implements ImageComparator {
  private readonly logger: Logger = new Logger(LookSameService.name);

  constructor(
    private readonly staticService: StaticService,
    private readonly diffWorkerPool: DiffWorkerPool
  ) {}

  parseConfig(configJson: string): LooksSameConfig {
    return parseConfig(configJson, DEFAULT_CONFIG, this.logger);
  }

  async getDiff(data: ImageCompareInput, config: LooksSameConfig): Promise<DiffResult> {
    const [baselineBuffer, imageBuffer] = await Promise.all([
      this.readBaseline(data.baseline),
      data.imageBuffer ?? this.staticService.getImageBuffer(data.image),
    ]);
    if (!baselineBuffer) {
      return NO_BASELINE_RESULT;
    }
    if (!imageBuffer) {
      throw new Error(`Cannot get image: ${data.image}`);
    }

    if (isByteEqualWellFormedPng(baselineBuffer, imageBuffer)) {
      return EQUAL_RESULT;
    }

    const output = await this.diffWorkerPool.run({
      kind: 'looks-same',
      baseline: baselineBuffer,
      image: imageBuffer,
      ignoreAreas: data.ignoreAreas,
      config,
      saveDiff: data.saveDiffAsFile,
    });
    switch (output.outcome) {
      case 'baseline-unreadable':
        return NO_BASELINE_RESULT;
      case 'image-unreadable':
        throw new Error(`Cannot get image: ${data.image}`);
      case 'equal':
        return EQUAL_RESULT;
      case 'diff-dimension':
        return DIFF_DIMENSION_RESULT;
    }

    output.errors.forEach((message) => this.logger.error(message));
    const result: DiffResult = { ...NO_BASELINE_RESULT, isSameDimension: output.isSameDimension };
    if (!output.result) {
      result.status = TestStatus.unresolved;
      return result;
    }

    const { equal, differentPixels, totalPixels } = output.result;
    result.pixelMisMatchCount = differentPixels;
    result.diffPercent = totalPixels && totalPixels > 0 ? ((differentPixels as number) * 100) / totalPixels : 0;

    const withinTolerance = result.diffPercent > 0 && result.diffPercent <= data.diffTollerancePercent;
    if (equal || withinTolerance) {
      result.status = TestStatus.ok;
    } else {
      result.status = TestStatus.unresolved;
      result.diffName = await this.saveDiff(output.diffPng);
    }

    return result;
  }

  private async readBaseline(name: string | null): Promise<Buffer | null> {
    try {
      return await this.staticService.getImageBuffer(name);
    } catch (error) {
      this.logger.error((error as Error).message);
      return null;
    }
  }

  async saveDiff(diffPng?: Uint8Array): Promise<string | null> {
    if (!diffPng) {
      return null;
    }
    try {
      // saveImage checks the PNG signature with Buffer#equals, which a Uint8Array from a worker lacks
      return await this.staticService.saveImage('diff', asBuffer(diffPng));
    } catch (error) {
      this.logger.error((error as Error).message);
      return null;
    }
  }
}
