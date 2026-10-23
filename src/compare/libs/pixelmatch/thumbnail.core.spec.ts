import { PNG } from 'pngjs';
import { encodeThumbnail, THUMBNAIL_MAX_DIMENSION } from './thumbnail.core';

const solid = (width: number, height: number): PNG => {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = 200;
    png.data[i * 4 + 1] = 100;
    png.data[i * 4 + 2] = 50;
    png.data[i * 4 + 3] = 255;
  }
  return png;
};

describe('encodeThumbnail', () => {
  // The grids draw these a hundred-odd pixels wide. Sending the full
  // screenshot and letting CSS shrink it cost ~7 MB and 68 requests every time
  // the variations dialog opened.
  it('brings a screenshot down to the thumbnail size', () => {
    const thumbnail = PNG.sync.read(encodeThumbnail(solid(1284, 2778)));

    expect(Math.max(thumbnail.width, thumbnail.height)).toBe(THUMBNAIL_MAX_DIMENSION);
  });

  it('keeps the proportions of the screenshot it came from', () => {
    const source = solid(1284, 2778);

    const thumbnail = PNG.sync.read(encodeThumbnail(source));

    expect(thumbnail.width / thumbnail.height).toBeCloseTo(source.width / source.height, 2);
  });

  it('is a fraction of the bytes of the original', () => {
    const source = solid(1284, 2778);

    expect(encodeThumbnail(source).length).toBeLessThan(PNG.sync.write(source).length / 10);
  });

  // a small screenshot re-encoded larger would be worse than leaving it alone
  it('never enlarges an image that is already small', () => {
    const thumbnail = PNG.sync.read(encodeThumbnail(solid(100, 80)));

    expect(thumbnail.width).toBe(100);
    expect(thumbnail.height).toBe(80);
  });
});
