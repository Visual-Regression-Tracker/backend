import { PNG } from 'pngjs';

export type Rgb = [number, number, number];

export const WHITE: Rgb = [255, 255, 255];

export const paintedPng = (
  width: number,
  height: number,
  paint: (x: number, y: number) => Rgb | undefined = () => undefined
): PNG => {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y) ?? WHITE;
      const index = (y * width + x) * 4;
      png.data[index] = r;
      png.data[index + 1] = g;
      png.data[index + 2] = b;
      png.data[index + 3] = 255;
    }
  }
  return png;
};

export const solidPng = (width: number, height: number, rgb: Rgb = WHITE): PNG => paintedPng(width, height, () => rgb);

export const pngBytes = (png: PNG): Buffer => PNG.sync.write(png);

export const square =
  (left: number, top: number, size: number, rgb: Rgb) =>
  (x: number, y: number): Rgb | undefined =>
    x >= left && x < left + size && y >= top && y < top + size ? rgb : undefined;
