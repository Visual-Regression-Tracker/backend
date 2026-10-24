import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { StaticService } from '../../../static/static.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { applyIgnoreAreas, parseConfig } from '../../utils';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { LooksSameConfig } from './looks-same.types';
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

  constructor(private readonly staticService: StaticService) {}

  parseConfig(configJson: string): LooksSameConfig {
    return parseConfig(configJson, DEFAULT_CONFIG, this.logger);
  }

  async getDiff(data: ImageCompareInput, config: LooksSameConfig): Promise<DiffResult> {
    const result: DiffResult = {
      ...NO_BASELINE_RESULT,
    };

    const baseline = await this.staticService.getImage(data.baseline);
    // a missing checkpoint image is not expected here, and fails on first use
    const image = (await this.staticService.getImage(data.image))!;

    if (!baseline) {
      return NO_BASELINE_RESULT;
    }

    if (baseline.data.equals(new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength))) {
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
    if (!compareResult) {
      // looks-same failed: keep the run for review instead of failing it
      result.status = TestStatus.unresolved;
      return result;
    }

    result.pixelMisMatchCount = compareResult.differentPixels;
    result.diffPercent =
      compareResult.totalPixels > 0 ? (compareResult.differentPixels * 100) / compareResult.totalPixels : 0;

    // The run's tolerance forgives a change as small as it, as pixelmatch and
    // odiff do. Only a counted change: one looks-same reports but cannot
    // measure (no pixels counted) is left for review whatever the tolerance.
    const withinTolerance = result.diffPercent > 0 && result.diffPercent <= data.diffTollerancePercent;
    if (compareResult.equal || withinTolerance) {
      result.status = TestStatus.ok;
    } else {
      result.status = TestStatus.unresolved;
      if (data.saveDiffAsFile) {
        result.diffName = await this.saveDiff(compareResult.diffImage);
      }
    }

    return result;
  }

  // one pass gives the verdict, the pixel counts and the diff image together
  async compare(
    baseline: PNG,
    image: PNG,
    config: LooksSameConfig
  ): Promise<looksSame.LooksSameResult<true> | undefined> {
    const [baselinePng, imagePng] = [PNG.sync.write(baseline), PNG.sync.write(image)];
    const run = (options: LooksSameConfig) => looksSame(baselinePng, imagePng, { ...options, createDiffImage: true });
    try {
      return await run(config);
    } catch (error) {
      this.logger.error((error as Error).message);
    }
    // Most likely a project config looks-same refuses ("strict" together with
    // "tolerance", say). That is the project's problem, not this screenshot's:
    // compare with the defaults, as for a config that is not JSON, rather than
    // leave every changed screenshot without numbers.
    this.logger.error('Looks-Same cannot compare with the project config, fallback to default one');
    return run(DEFAULT_CONFIG).catch((error): undefined => {
      this.logger.error(error.message);
      return undefined;
    });
  }

  async saveDiff(diffImage: looksSame.DiffImage): Promise<string | null> {
    try {
      return await this.staticService.saveImage('diff', await diffImage.createBuffer('png'));
    } catch (error) {
      this.logger.error((error as Error).message);
      return null;
    }
  }
}
