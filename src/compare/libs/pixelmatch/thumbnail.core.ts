import { PNG } from 'pngjs';
import { downscale, RawImage } from '../../utils';

export const THUMBNAIL_MAX_DIMENSION = 400;

export function encodeThumbnail(source: RawImage): Buffer {
  const small = downscale(source, THUMBNAIL_MAX_DIMENSION);
  const png = new PNG({ width: small.width, height: small.height });
  small.data.copy(png.data);
  return PNG.sync.write(png);
}
