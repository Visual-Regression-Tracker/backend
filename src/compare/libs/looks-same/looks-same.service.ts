import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { StaticService } from '../../../shared/static/static.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { applyIgnoreAreas } from '../../utils';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { LookSameResult, LooksSameConfig } from './looks-same.types';
import looksSame from 'looks-same';

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
    try {
      return JSON.parse(configJson) ?? DEFAULT_CONFIG;
    } catch (ex) {
      this.logger.error('Cannot parse config, fallback to default one ' + ex);
    }
    return DEFAULT_CONFIG;
  }

  async getDiff(data: ImageCompareInput, config: LooksSameConfig): Promise<DiffResult> {
    let result: DiffResult = {
      status: undefined,
      diffName: null,
      pixelMisMatchCount: undefined,
      diffPercent: undefined,
      isSameDimension: undefined,
    };

    const baseline = this.staticService.getImage(data.baseline);
    const image = this.staticService.getImage(data.image);

    if (!baseline) {
      this.logger.log('No baseline');
      return result;
    }

    result.isSameDimension = baseline.width === image.width && baseline.height === image.height;

    if (baseline.data.equals(image.data)) {
      // equal images
      result.status = TestStatus.ok;
      return result;
    }

    if (!result.isSameDimension && !config.allowDiffDimensions) {
      // diff dimensions
      result.status = TestStatus.unresolved;
      return result;
    }

    // apply ignore areas
    const baselineIgnored = applyIgnoreAreas(baseline, data.ignoreAreas);
    const imageIgnored = applyIgnoreAreas(image, data.ignoreAreas);

    // compare
    const compareResult: LookSameResult = await this.compare(baselineIgnored, imageIgnored, config);
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

  async compare(baseline: PNG, image: PNG, config: LooksSameConfig): Promise<LookSameResult> {
    return new Promise((resolve, reject) => {
      looksSame(
        PNG.sync.write(baseline),
        PNG.sync.write(image),
        config,
        (error: Error | null, diffResult: LookSameResult) => {
          if (error) {
            this.logger.error(error.message);
            reject(error);
          }
          resolve(diffResult);
        }
      );
    });
  }

  async createDiff(baseline: PNG, image: PNG, config: LooksSameConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      looksSame.createDiff(
        {
          reference: PNG.sync.write(baseline),
          current: PNG.sync.write(image),
          highlightColor: '#ff00ff',
          ...config,
        },
        (error: Error | null, buffer: Buffer) => {
          if (error) {
            this.logger.error(error.message);
            reject(error);
          }
          const diffName = this.staticService.saveImage('diff', buffer);
          resolve(diffName);
        }
      );
    });
  }
}
