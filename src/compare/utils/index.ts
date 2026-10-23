import { Logger } from '@nestjs/common';
import { PNG } from 'pngjs';
import { IgnoreAreaDto } from 'src/test-runs/dto/ignore-area.dto';

export function scaleImageToSize(image: PNG, width: number, height: number): PNG {
  if (width > image.width || height > image.height) {
    const preparedImage = new PNG({ width, height, fill: true });
    PNG.bitblt(image, preparedImage, 0, 0, image.width, image.height);
    return preparedImage;
  }
  return image;
}

export function applyIgnoreAreas(image: PNG, ignoreAreas: IgnoreAreaDto[]): PNG {
  ignoreAreas.forEach((area) => {
    for (let y = area.y; y < Math.min(area.y + area.height, image.height); y++) {
      for (let x = area.x; x < Math.min(area.x + area.width, image.width); x++) {
        const k = 4 * (image.width * y + x);
        image.data[k + 0] = 0;
        image.data[k + 1] = 0;
        image.data[k + 2] = 0;
        image.data[k + 3] = 0;
      }
    }
  });
  return image;
}

export const parseConfig = <T>(configJson: string, defaultConfig: T, logger: Logger) => {
  try {
    return JSON.parse(configJson) ?? defaultConfig;
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

// Nearest-neighbour downscale so the longest side is at most maxDimension.
// Returns the original when already small enough.
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
