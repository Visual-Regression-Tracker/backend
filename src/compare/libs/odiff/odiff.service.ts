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
    if (!data.baseline) {
      return NO_BASELINE_RESULT;
    }

    const baselinePath = this.hddService.getImagePath(data.baseline);
    const diff = this.hddService.generateNewImage('diff');
    const ignoreRegions = ignoreAreaToRegionMapper(data.ignoreAreas);
    const compareResult = await compare(baselinePath, this.hddService.getImagePath(data.image), diff.imagePath, {
      ...config,
      diffColor: '#cd2cc9',
      noFailOnFsErrors: true,
      // odiff rejects an empty --ignore= argument, so only pass regions when there are any
      ...(ignoreRegions.length > 0 && { ignoreRegions }),
    });

    if (compareResult.match === true) {
      return EQUAL_RESULT;
    }
    if (compareResult.reason === 'file-not-exists') {
      if (compareResult.file === baselinePath) {
        return NO_BASELINE_RESULT;
      }
      throw new Error(`Cannot get image: ${data.image}`);
    }
    if (compareResult.reason === 'layout-diff') {
      return DIFF_DIMENSION_RESULT;
    }

    const withinTolerance = compareResult.diffPercentage <= data.diffTollerancePercent;
    const result: DiffResult = {
      ...NO_BASELINE_RESULT,
      isSameDimension: true,
      diffPercent: compareResult.diffPercentage,
      pixelMisMatchCount: compareResult.diffCount,
      status: withinTolerance ? TestStatus.ok : TestStatus.unresolved,
    };
    if (!withinTolerance && data.saveDiffAsFile) {
      result.diffName = diff.imageName;
    } else {
      await this.staticService.deleteImage(diff.imageName);
    }
    return result;
  }
}

export const ignoreAreaToRegionMapper = (ignoreAreas: IgnoreAreaDto[]): OdiffIgnoreRegions =>
  ignoreAreas.flatMap((item) => {
    const region = {
      x1: Math.max(0, Math.floor(item.x)),
      y1: Math.max(0, Math.floor(item.y)),
      x2: Math.ceil(item.x + item.width),
      y2: Math.ceil(item.y + item.height),
    };
    const usable = Object.values(region).every(Number.isFinite) && region.x2 >= region.x1 && region.y2 >= region.y1;
    return usable ? [region] : [];
  });
