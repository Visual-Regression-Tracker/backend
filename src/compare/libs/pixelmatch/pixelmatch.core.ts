import { PNG } from 'pngjs';
import Pixelmatch from 'pixelmatch';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { applyIgnoreAreas, readPng, scaleImageToSize } from '../../utils';
import { signatureOfDecoded } from './signature.core';
import { encodeThumbnail } from './thumbnail.core';

export interface PixelmatchJobInput {
  kind: 'diff';
  baseline: Buffer | Uint8Array;
  image: Buffer | Uint8Array;
  ignoreAreas: IgnoreAreaDto[];
  threshold: number;
  includeAA: boolean;
  allowDiffDimensions?: boolean;
  diffTolerancePercent: number;
  saveDiff: boolean;
}

export interface PixelmatchJobOutput {
  equal?: boolean;
  isSameDimension?: boolean;
  pixelMisMatchCount?: number;
  diffPercent?: number;
  diffBuffer?: Buffer | Uint8Array;
  signature?: number[];
  imageThumbnail?: Buffer | Uint8Array;
  diffThumbnail?: Buffer | Uint8Array;
}

export function computePixelmatchDiff(input: PixelmatchJobInput): PixelmatchJobOutput {
  const baseline = readPng(input.baseline);
  const image = readPng(input.image);

  const isSameDimension = baseline.width === image.width && baseline.height === image.height;
  if (!isSameDimension && !input.allowDiffDimensions) {
    return { equal: false, isSameDimension };
  }

  if (isSameDimension && baseline.data.equals(image.data)) {
    return { equal: true };
  }

  const maxWidth = Math.max(baseline.width, image.width);
  const maxHeight = Math.max(baseline.height, image.height);
  const baselineIgnored = applyIgnoreAreas(scaleImageToSize(baseline, maxWidth, maxHeight), input.ignoreAreas);
  const imageIgnored = applyIgnoreAreas(scaleImageToSize(image, maxWidth, maxHeight), input.ignoreAreas);

  const diff = new PNG({ width: maxWidth, height: maxHeight });
  const pixelMisMatchCount = Pixelmatch(baselineIgnored.data, imageIgnored.data, diff.data, maxWidth, maxHeight, {
    includeAA: input.includeAA,
    threshold: input.threshold,
  });
  const diffPercent = (pixelMisMatchCount * 100) / (maxWidth * maxHeight);

  const overTolerance = diffPercent > input.diffTolerancePercent;

  const keepingTheDiff = overTolerance && input.saveDiff;
  const diffBuffer = keepingTheDiff ? PNG.sync.write(diff, { filterType: 1 }) : undefined;

  const signature =
    input.saveDiff && isSameDimension
      ? signatureOfDecoded(baselineIgnored, imageIgnored, {
          threshold: input.threshold,
          includeAA: input.includeAA,
        })
      : null;

  const thumbnails = keepingTheDiff
    ? { imageThumbnail: encodeThumbnail(imageIgnored), diffThumbnail: encodeThumbnail(diff) }
    : {};

  return {
    equal: false,
    isSameDimension,
    pixelMisMatchCount,
    diffPercent,
    diffBuffer,
    ...(signature ? { signature } : {}),
    ...thumbnails,
  };
}
