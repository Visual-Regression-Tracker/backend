import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { StaticService } from '../../../shared/static/static.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { parseConfig } from '../../utils';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { DIFF_DIMENSION_RESULT, NO_BASELINE_RESULT } from '../consts';
import { compare } from 'odiff-bin';
import { IgnoreAreaDto } from 'src/test-runs/dto/ignore-area.dto';
import { OdiffConfig, OdiffIgnoreRegions, OdiffResult } from './odiff.types';

export const DEFAULT_CONFIG: OdiffConfig = {
  outputDiffMask: true,
  failOnLayoutDiff: true,
  threshold: 0,
  antialiasing: true,
};

@Injectable()
export class OdiffService implements ImageComparator {
  private readonly logger: Logger = new Logger(OdiffService.name);

  constructor(private staticService: StaticService) {}

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
    const diff = this.staticService.generateNewImage('diff');
    const compareResult = (await compare(
      this.staticService.getImagePath(data.baseline),
      this.staticService.getImagePath(data.image),
      diff.imagePath,
      {
        ...config,
        diffColor: '#cd2cc9',
        ignoreRegions: ignoreAreaToRegionMapper(data.ignoreAreas),
      }
    )) as OdiffResult;

    if (compareResult.reason === 'layout-diff') {
      return DIFF_DIMENSION_RESULT;
    } else {
      result.isSameDimension = true;
    }
    result.diffPercent = compareResult.diffPercentage ?? 0;
    result.pixelMisMatchCount = compareResult.diffCount ?? 0;

    // process result
    if (result.diffPercent > data.diffTollerancePercent) {
      // save diff
      if (data.saveDiffAsFile) {
        result.diffName = diff.imageName;
      } else {
        this.staticService.deleteImage(diff.imagePath);
      }
      result.status = TestStatus.unresolved;
    } else {
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
