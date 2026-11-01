import { PNG } from 'pngjs';
import Pixelmatch from 'pixelmatch';
import { isByteEqualWellFormedPng } from '../../../static/utils';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { applyIgnoreAreas, readPng, scaleImageToSize } from '../../utils';
import {
  BlurAmplitudeOptions,
  BlurredDifference,
  isRenderingNoise,
  measureBlurredDifference,
} from './blur-amplitude.core';
import { DINOV2_PATCH, gateOfDecoded, PatchGate } from './patch-gate.core';
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
  blurAmplitude?: BlurAmplitudeOptions;
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
  blurAmplitude?: number;
  solidPixels?: number;
  renderingNoiseOnly?: boolean;
  gate?: PatchGate;
}

export function computePixelmatchDiff(input: PixelmatchJobInput): PixelmatchJobOutput {
  if (isByteEqualWellFormedPng(input.baseline, input.image)) {
    return { equal: true };
  }

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
  const scaledBaseline = scaleImageToSize(baseline, maxWidth, maxHeight);
  const scaledImage = scaleImageToSize(image, maxWidth, maxHeight);

  const baselineIgnored = applyIgnoreAreas(scaledBaseline, input.ignoreAreas);
  const imageIgnored = applyIgnoreAreas(scaledImage, input.ignoreAreas);

  const diff = new PNG({ width: maxWidth, height: maxHeight });
  const pixelMisMatchCount = Pixelmatch(baselineIgnored.data, imageIgnored.data, diff.data, maxWidth, maxHeight, {
    includeAA: input.includeAA,
    threshold: input.threshold,
  });
  const diffPercent = (pixelMisMatchCount * 100) / (scaledImage.width * scaledImage.height);

  const overTolerance = diffPercent > input.diffTolerancePercent;
  const blurAmplitude = overTolerance && isSameDimension ? input.blurAmplitude : undefined;
  let measure: BlurredDifference | null = null;
  let renderingNoiseOnly = false;
  if (blurAmplitude) {
    measure = measureBlurredDifference(baselineIgnored, imageIgnored);
    renderingNoiseOnly = isRenderingNoise(measure, blurAmplitude.threshold);
  }

  const gate =
    renderingNoiseOnly && blurAmplitude?.dinov2
      ? gateOfDecoded(baselineIgnored, imageIgnored, DINOV2_PATCH)
      : undefined;

  const keepingTheDiff = overTolerance && input.saveDiff && (!renderingNoiseOnly || !!blurAmplitude?.dinov2);
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
    ...(gate ? { gate } : {}),
    ...(blurAmplitude
      ? {
          renderingNoiseOnly,
          ...(measure ? { blurAmplitude: measure.amplitude, solidPixels: measure.solidPixels } : {}),
        }
      : {}),
  };
}
