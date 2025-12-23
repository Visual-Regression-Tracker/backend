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
