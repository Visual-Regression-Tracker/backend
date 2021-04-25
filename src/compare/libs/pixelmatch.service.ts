import { Injectable } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import Pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { StaticService } from 'src/shared/static/static.service';
import { DiffResult } from 'src/test-runs/diffResult';
import { ImageComparator, ImageCompareInput } from './image-comparator.interface';

@Injectable()
export class PixelmatchService implements ImageComparator {
  constructor(private staticService: StaticService) {}

  getDiff(data: ImageCompareInput): DiffResult {
    const result: DiffResult = {
      status: undefined,
      diffName: null,
      pixelMisMatchCount: undefined,
      diffPercent: undefined,
      isSameDimension: undefined,
    };

    const baseline = this.staticService.getImage(data.baseline);
    const image = this.staticService.getImage(data.image);

    if (!baseline) {
      // no baseline
      return result;
    }

    result.isSameDimension = baseline.width === image.width && baseline.height === image.height;

    if (baseline.data.equals(image.data)) {
      // equal images
      result.status = TestStatus.ok;
      result.pixelMisMatchCount = 0;
      result.diffPercent = 0;
      return result;
    }

    if (!result.isSameDimension && !process.env.ALLOW_DIFF_DIMENSIONS) {
      // diff dimensions
      result.status = TestStatus.unresolved;
      return result;
    }

    // scale image to max size
    const maxWidth = Math.max(baseline.width, image.width);
    const maxHeight = Math.max(baseline.height, image.height);
    const scaledBaseline = this.scaleImageToSize(baseline, maxWidth, maxHeight);
    const scaledImage = this.scaleImageToSize(image, maxWidth, maxHeight);

    // apply ignore areas
    const baselineData = this.applyIgnoreAreas(scaledBaseline, data.ignoreAreas);
    const imageData = this.applyIgnoreAreas(scaledImage, data.ignoreAreas);

    // compare
    const diff = new PNG({
      width: maxWidth,
      height: maxHeight,
    });
    result.pixelMisMatchCount = Pixelmatch(baselineData, imageData, diff.data, maxWidth, maxHeight, {
      includeAA: true,
    });
    result.diffPercent = (result.pixelMisMatchCount * 100) / (scaledImage.width * scaledImage.height);

    // process result
    if (result.diffPercent > testRun.diffTollerancePercent) {
      // save diff
      result.diffName = this.staticService.saveImage('diff', PNG.sync.write(diff));
      result.status = TestStatus.unresolved;
    } else {
      result.status = TestStatus.ok;
    }
    return result;
  }
}
