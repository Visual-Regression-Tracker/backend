import { Logger } from '@nestjs/common';
import { PNG } from 'pngjs';
import { IgnoreAreaDto } from '../../test-runs/dto/ignore-area.dto';
import { asBuffer } from '../../static/utils';

export function scaleImageToSize(image: PNG, width: number, height: number): PNG {
  if (width > image.width || height > image.height) {
    const preparedImage = new PNG({ width, height, fill: true });
    PNG.bitblt(image, preparedImage, 0, 0, image.width, image.height);
    return preparedImage;
  }
  return image;
}

export function readPng(data: Buffer | Uint8Array): PNG {
  return PNG.sync.read(asBuffer(data));
}

export function tryReadPng(data: Buffer | Uint8Array): PNG | null {
  try {
    return readPng(data);
  } catch {
    return null;
  }
}

export function readSameSizePair(
  baselineBytes: Buffer | Uint8Array,
  imageBytes: Buffer | Uint8Array,
  ignoreAreas: IgnoreAreaDto[]
): { baseline: PNG; image: PNG } | null {
  const baseline = tryReadPng(baselineBytes);
  const image = baseline && tryReadPng(imageBytes);
  if (!baseline || !image) {
    return null;
  }
  if (baseline.width !== image.width || baseline.height !== image.height) {
    return null;
  }
  applyIgnoreAreas(baseline, ignoreAreas);
  applyIgnoreAreas(image, ignoreAreas);
  return { baseline, image };
}

export function applyIgnoreAreas(image: PNG, ignoreAreas: IgnoreAreaDto[]): PNG {
  for (const area of ignoreAreas) {
    if (!area) {
      continue;
    }
    const x0 = Math.max(0, Math.floor(area.x));
    const y0 = Math.max(0, Math.floor(area.y));
    const x1 = Math.min(image.width, Math.ceil(area.x + area.width));
    const y1 = Math.min(image.height, Math.ceil(area.y + area.height));
    if (!(x1 > x0 && y1 > y0)) {
      continue;
    }
    for (let y = y0; y < y1; y++) {
      image.data.fill(0, 4 * (image.width * y + x0), 4 * (image.width * y + x1));
    }
  }
  return image;
}

export const parseConfig = <T>(configJson: string, defaultConfig: T, logger: Logger): T => {
  try {
    const config = JSON.parse(configJson);
    if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
      return { ...defaultConfig, ...config };
    }
    if (config !== null) {
      logger.error('Config is not a JSON object, fallback to default one');
    }
  } catch (ex) {
    logger.error('Cannot parse config, fallback to default one ' + ex);
  }
  return defaultConfig;
};

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

export function downscale(source: RawImage, maxDimension: number): RawImage {
  const scale = maxDimension / Math.max(source.width, source.height);
  if (scale >= 1) {
    return source;
  }
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const data: Buffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(source.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(source.width - 1, Math.floor(x / scale));
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;
      data[targetIndex] = source.data[sourceIndex];
      data[targetIndex + 1] = source.data[sourceIndex + 1];
      data[targetIndex + 2] = source.data[sourceIndex + 2];
      data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }
  return { data, width, height };
}
