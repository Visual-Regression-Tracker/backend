import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { StaticService } from '../../../shared/static/static.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { applyIgnoreAreas, parseConfig } from '../../utils';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { LookSameResult, LooksSameConfig } from './looks-same.types';
import looksSame from 'looks-same';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';

export const DEFAULT_CONFIG: LooksSameConfig = {
  strict: false,
  ignoreAntialiasing: true,
  ignoreCaret: true,
  allowDiffDimensions: false,
};

@Injectable()
export class LookSameService implements ImageComparator {
  private readonly logger: Logger = new Logger(LookSameService.name);

  constructor(private staticService: StaticService) {}

  parseConfig(configJson: string): LooksSameConfig {
    return parseConfig(configJson, DEFAULT_CONFIG, this.logger);
  }

  async getDiff(data: ImageCompareInput, config: LooksSameConfig): Promise<DiffResult> {
    const result: DiffResult = {
      ...NO_BASELINE_RESULT,
    };

    const baseline = this.staticService.getImage(data.baseline);
    const image = this.staticService.getImage(data.image);

    if (!baseline) {
      return NO_BASELINE_RESULT;
    }

    if (baseline.data.equals(image.data)) {
      return EQUAL_RESULT;
    }

    result.isSameDimension = baseline.width === image.width && baseline.height === image.height;
    if (!result.isSameDimension && !config.allowDiffDimensions) {
      return DIFF_DIMENSION_RESULT;
    }

    // apply ignore areas
    const baselineIgnored = applyIgnoreAreas(baseline, data.ignoreAreas);
    const imageIgnored = applyIgnoreAreas(image, data.ignoreAreas);

    // compare
    const compareResult = await this.compare(baselineIgnored, imageIgnored, config);
    if (compareResult.equal) {
      result.status = TestStatus.ok;
    } else {
      result.status = TestStatus.unresolved;
      if (data.saveDiffAsFile) {
        result.diffName = await this.createDiff(baselineIgnored, imageIgnored, config);
      }
    }

    return result;
  }

  async compare(baseline: PNG, image: PNG, config: LooksSameConfig): Promise<LookSameResult | undefined> {
    const diffResult = await looksSame(PNG.sync.write(baseline), PNG.sync.write(image), config).catch((error) => {
      this.logger.error(error.message);
    });
    if (diffResult) {
      return diffResult;
    }
    return undefined;
  }

  async createDiff(baseline: PNG, image: PNG, config: LooksSameConfig): Promise<string | undefined> {
    const buffer = await looksSame
      .createDiff({
        reference: PNG.sync.write(baseline),
        current: PNG.sync.write(image),
        highlightColor: '#ff00ff',
        ...config,
      })
      .catch((error) => {
        this.logger.error(error.message);
      });
    if (buffer) {
      return this.staticService.saveImage('diff', buffer);
    }
    return undefined;
  }
}
