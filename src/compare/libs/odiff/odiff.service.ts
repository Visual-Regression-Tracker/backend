import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { StaticService } from '../../../static/static.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { parseConfig } from '../../utils';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';
import { compare } from 'odiff-bin';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { OdiffConfig, OdiffIgnoreRegions } from './odiff.types';
import { HddService } from '../../../static/hdd/hdd.service';

export const DEFAULT_CONFIG: OdiffConfig = {
  outputDiffMask: true,
  failOnLayoutDiff: true,
  threshold: 0,
  antialiasing: true,
};

@Injectable()
export class OdiffService implements ImageComparator {
  private readonly logger: Logger = new Logger(OdiffService.name);

  constructor(
    private readonly staticService: StaticService,
    private readonly hddService: HddService
  ) {}

  parseConfig(configJson: string): OdiffConfig {
    return parseConfig(configJson, DEFAULT_CONFIG, this.logger);
  }

  async getDiff(data: ImageCompareInput, config: OdiffConfig): Promise<DiffResult> {
    const result: DiffResult = {
      ...NO_BASELINE_RESULT,
    };

    if (!data.baseline) {
      return NO_BASELINE_RESULT;
    }

    // compare
    const baselinePath = this.hddService.getImagePath(data.baseline);
    const diff = this.hddService.generateNewImage('diff');
    const compareResult = await compare(baselinePath, this.hddService.getImagePath(data.image), diff.imagePath, {
      ...config,
      diffColor: '#cd2cc9',
      // a missing file comes back as a result instead of an error naming the file
      noFailOnFsErrors: true,
      // odiff rejects an empty --ignore= argument, so only pass regions when there are any
      ...(data.ignoreAreas.length > 0 && { ignoreRegions: ignoreAreaToRegionMapper(data.ignoreAreas) }),
    });

    if (compareResult.match === true) {
      return EQUAL_RESULT;
    }
    if (compareResult.reason === 'file-not-exists') {
      // same as the other comparators: a missing baseline file means there is nothing to compare with
      if (compareResult.file === baselinePath) {
        return NO_BASELINE_RESULT;
      }
      throw new Error(`Cannot get image: ${data.image}`);
    }
    if (compareResult.reason === 'layout-diff') {
      return DIFF_DIMENSION_RESULT;
    }

    // pixel diff: odiff has written the diff image
    result.isSameDimension = true;
    result.diffPercent = compareResult.diffPercentage;
    result.pixelMisMatchCount = compareResult.diffCount;

    // process result
    // odiff-bin leaves the numbers out when it cannot parse the binary output: keep the run for review
    if (!(result.diffPercent <= data.diffTollerancePercent)) {
      // save diff
      if (data.saveDiffAsFile) {
        result.diffName = diff.imageName;
      } else {
        await this.staticService.deleteImage(diff.imageName);
      }
      result.status = TestStatus.unresolved;
    } else {
      await this.staticService.deleteImage(diff.imageName);
      result.status = TestStatus.ok;
    }
    return result;
  }
}

export const ignoreAreaToRegionMapper = (ignoreAreas: IgnoreAreaDto[]): OdiffIgnoreRegions => {
  return ignoreAreas.map((item) => ({
    x1: item.x,
    y1: item.y,
    x2: item.x + item.width,
    y2: item.y + item.height,
  }));
};
