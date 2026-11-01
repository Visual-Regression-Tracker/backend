import { PNG } from 'pngjs';
import Pixelmatch from 'pixelmatch';
import { RawImage } from '../../utils';

export const DINOV2_PATCH = 14;

export interface PatchGate {
  width: number;
  height: number;
  cells: number[];
}

export function gateOfDecoded(baseline: RawImage, image: RawImage, patch: number): PatchGate {
  const { width, height } = baseline;

  const mask = new PNG({ width, height });
  Pixelmatch(baseline.data, image.data, mask.data, width, height, { threshold: 0.1, includeAA: false, diffMask: true });

  const columns = Math.ceil(width / patch);
  const rows = Math.ceil(height / patch);
  const marked = new Uint8Array(columns * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask.data[(y * width + x) * 4 + 3] > 0) {
        marked[Math.floor(y / patch) * columns + Math.floor(x / patch)] = 1;
      }
    }
  }
  const cells: number[] = [];
  marked.forEach((value, index) => value && cells.push(index));
  return { width: columns, height: rows, cells };
}
