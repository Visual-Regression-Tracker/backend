import { PNG } from 'pngjs';
import { solidPng } from '../../test-utils';
import { encodeThumbnail, THUMBNAIL_MAX_DIMENSION } from './thumbnail.core';

const solid = (width: number, height: number): PNG => solidPng(width, height, [200, 100, 50]);

describe('encodeThumbnail', () => {
  const source = solid(1284, 2778);

  it('brings a screenshot down to the thumbnail size', () => {
    const thumbnail = PNG.sync.read(encodeThumbnail(source));

    expect(Math.max(thumbnail.width, thumbnail.height)).toBe(THUMBNAIL_MAX_DIMENSION);
  });

  it('keeps the proportions of the screenshot it came from', () => {
    const thumbnail = PNG.sync.read(encodeThumbnail(source));

    expect(thumbnail.width / thumbnail.height).toBeCloseTo(source.width / source.height, 2);
  });

  it('is a fraction of the bytes of the original', () => {
    expect(encodeThumbnail(source).length).toBeLessThan(PNG.sync.write(source, { filterType: 1 }).length / 10);
  });

  it('never enlarges an image that is already small', () => {
    const thumbnail = PNG.sync.read(encodeThumbnail(solid(100, 80)));

    expect(thumbnail.width).toBe(100);
    expect(thumbnail.height).toBe(80);
  });
});
