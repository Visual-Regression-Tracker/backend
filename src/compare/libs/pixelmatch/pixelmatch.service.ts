import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import Pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { StaticService } from '../../../shared/static/static.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { scaleImageToSize, applyIgnoreAreas, parseConfig } from '../../utils';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { PixelmatchConfig } from './pixelmatch.types';

export const DEFAULT_CONFIG: PixelmatchConfig = { threshold: 0.1, ignoreAntialiasing: true };

@Injectable()
export class PixelmatchService implements ImageComparator {
  private readonly logger: Logger = new Logger(PixelmatchService.name);

  constructor(private staticService: StaticService) {}

  parseConfig(configJson: string): PixelmatchConfig {
    return parseConfig(configJson, DEFAULT_CONFIG, this.logger);
  }

  async getDiff(data: ImageCompareInput, config: PixelmatchConfig): Promise<DiffResult> {
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

    // scale image to max size
    const maxWidth = Math.max(baseline.width, image.width);
    const maxHeight = Math.max(baseline.height, image.height);
    const scaledBaseline = scaleImageToSize(baseline, maxWidth, maxHeight);
    const scaledImage = scaleImageToSize(image, maxWidth, maxHeight);

    // apply ignore areas
    const baselineIgnored = applyIgnoreAreas(scaledBaseline, data.ignoreAreas);
    const imageIgnored = applyIgnoreAreas(scaledImage, data.ignoreAreas);

    // compare
    const diff = new PNG({
      width: maxWidth,
      height: maxHeight,
    });
    result.pixelMisMatchCount = Pixelmatch(baselineIgnored.data, imageIgnored.data, diff.data, maxWidth, maxHeight, {
      includeAA: config.ignoreAntialiasing,
      threshold: config.threshold,
    });
    result.diffPercent = (result.pixelMisMatchCount * 100) / (scaledImage.width * scaledImage.height);

    // process result
    if (result.diffPercent > data.diffTollerancePercent) {
      // save diff
      if (data.saveDiffAsFile) {
        result.diffName = this.staticService.saveImage('diff', PNG.sync.write(diff));
      }
      result.status = TestStatus.unresolved;
    } else {
      result.status = TestStatus.ok;
    }
    return result;
  }
}
