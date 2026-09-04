import { PNG } from 'pngjs';
import Pixelmatch from 'pixelmatch';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { applyIgnoreAreas, scaleImageToSize } from '../../utils';
import { signatureOfDecoded } from './signature.core';

/**
 * CPU-bound part of the pixelmatch comparison, extracted so it can run inside
 * a worker thread (see pixelmatch.worker.ts / DiffWorkerPool): PNG decode,
 * scaling, pixelmatch and diff encode of full-size screenshots block the event
 * loop for ~a second each, which makes the whole API unresponsive during
 * build ingestion. All input/output must stay structured-clone serializable.
 */
export interface PixelmatchJobInput {
  kind: 'diff';
  baseline: Buffer | Uint8Array;
  image: Buffer | Uint8Array;
  ignoreAreas: IgnoreAreaDto[];
  threshold: number;
  includeAA: boolean;
  allowDiffDimensions: boolean;
  diffTolerancePercent: number;
  saveDiff: boolean;
  /**
   * Also produce the change signature the variations dialog matches on. Free
   * here next to the diff — the images are decoded already — and computed once
   * at ingest so reviewing never has to fetch and decode a build's screenshots
   * again just to group them.
   */
  withSignature?: boolean;
}

export interface PixelmatchJobOutput {
  equal?: boolean;
  isSameDimension?: boolean;
  pixelMisMatchCount?: number;
  diffPercent?: number;
  diffBuffer?: Buffer | Uint8Array;
  // absent when not asked for, when the screenshots are identical, or when
  // their dimensions differ and there is nothing meaningful to sign
  signature?: number[];
}

// postMessage turns Buffers into Uint8Array views over their own ArrayBuffer.
function toBuffer(data: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

export function computePixelmatchDiff(input: PixelmatchJobInput): PixelmatchJobOutput {
  const baseline = PNG.sync.read(toBuffer(input.baseline));
  const image = PNG.sync.read(toBuffer(input.image));

  if (baseline.data.equals(new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength))) {
    return { equal: true };
  }

  const isSameDimension = baseline.width === image.width && baseline.height === image.height;
  if (!isSameDimension && !input.allowDiffDimensions) {
    return { equal: false, isSameDimension };
  }

  // scale image to max size
  const maxWidth = Math.max(baseline.width, image.width);
  const maxHeight = Math.max(baseline.height, image.height);
  const scaledBaseline = scaleImageToSize(baseline, maxWidth, maxHeight);
  const scaledImage = scaleImageToSize(image, maxWidth, maxHeight);

  // apply ignore areas
  const baselineIgnored = applyIgnoreAreas(scaledBaseline, input.ignoreAreas);
  const imageIgnored = applyIgnoreAreas(scaledImage, input.ignoreAreas);

  // compare
  const diff = new PNG({
    width: maxWidth,
    height: maxHeight,
  });
  const pixelMisMatchCount = Pixelmatch(baselineIgnored.data, imageIgnored.data, diff.data, maxWidth, maxHeight, {
    includeAA: input.includeAA,
    threshold: input.threshold,
  });
  const diffPercent = (pixelMisMatchCount * 100) / (scaledImage.width * scaledImage.height);

  let diffBuffer: Buffer;
  if (diffPercent > input.diffTolerancePercent && input.saveDiff) {
    diffBuffer = PNG.sync.write(diff);
  }

  // Same source images, same ignore areas, same threshold as the standalone
  // signature job — sharing signatureOfDecoded is what keeps the two answers
  // identical, so a stored signature still matches one computed on the fly.
  const signature =
    input.withSignature && isSameDimension
      ? signatureOfDecoded(baselineIgnored, imageIgnored, {
          threshold: input.threshold,
          includeAA: input.includeAA,
        })
      : null;

  return {
    equal: false,
    isSameDimension,
    pixelMisMatchCount,
    diffPercent,
    diffBuffer,
    ...(signature ? { signature } : {}),
  };
}
