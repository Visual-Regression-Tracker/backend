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

export function applyIgnoreAreas(image: PNG, ignoreAreas: IgnoreAreaDto[]): Buffer {
  ignoreAreas.forEach((area) => {
    for (let y = area.y; y < area.y + area.height; y++) {
      for (let x = area.x; x < area.x + area.width; x++) {
        const k = 4 * (image.width * y + x);
        image.data[k + 0] = 0;
        image.data[k + 1] = 0;
        image.data[k + 2] = 0;
        image.data[k + 3] = 0;
      }
    }
  });
  return image.data;
}
