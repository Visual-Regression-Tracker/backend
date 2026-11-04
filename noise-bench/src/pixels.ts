import { PNG } from "pngjs";

/** Pixels whose RGBA differs at all; a size change counts every pixel of the larger image. */
export function countDifferentPixels(a: Buffer, b: Buffer): number {
  const first = PNG.sync.read(a);
  const second = PNG.sync.read(b);
  if (first.width !== second.width || first.height !== second.height) {
    return Math.max(first.width * first.height, second.width * second.height);
  }
  let count = 0;
  for (let i = 0; i < first.data.length; i += 4) {
    if (first.data.readUInt32BE(i) !== second.data.readUInt32BE(i)) {
      count++;
    }
  }
  return count;
}
