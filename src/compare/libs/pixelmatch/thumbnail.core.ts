import { PNG } from 'pngjs';
import { downscale, RawImage } from '../../utils';

/**
 * Longest side, in pixels, of the picture the grids draw. They lay these out a
 * hundred-odd pixels wide, so this leaves room for a retina screen and nothing
 * more. Sending the full screenshot and letting CSS shrink it cost roughly 7 MB
 * and 68 requests every time the variations dialog opened.
 */
export const THUMBNAIL_MAX_DIMENSION = 400;

/**
 * A small PNG of an already-decoded image, for the card grids. Produced beside
 * the diff, from the pixels it has already decoded, so a thumbnail costs a
 * resize rather than a second read of the screenshot.
 *
 * An image already within the bound is re-encoded as it is: enlarging it would
 * make it bigger on the wire for no gain.
 */
export function encodeThumbnail(source: RawImage): Buffer {
  const small = downscale(source, THUMBNAIL_MAX_DIMENSION);
  const png = new PNG({ width: small.width, height: small.height });
  small.data.copy(png.data);
  return PNG.sync.write(png);
}
