import { PNG } from 'pngjs';
import Pixelmatch from 'pixelmatch';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { applyIgnoreAreas } from '../../utils';

/**
 * Where a DINOv2 look at two screenshots should count (see
 * dinov2/dinov2.service.ts): the patches in which pixelmatch, with its
 * anti-aliasing detector on, sees a change. Elsewhere a content distance is
 * the model's context bleeding across a tile, not a change — measured in
 * research/jepa-screenshot-diff, where this gate took DINOv2 from 14% to 73%
 * of bugs caught. Runs on the diff worker pool; all input/output must stay
 * structured-clone serializable.
 */
export interface PatchGateJobInput {
  kind: 'patch-gate';
  baseline: Buffer | Uint8Array;
  image: Buffer | Uint8Array;
  ignoreAreas: IgnoreAreaDto[];
  // the model's patch size in pixels
  patch: number;
}

export interface PatchGate {
  // patches across and down, covering the screenshot
  width: number;
  height: number;
  // indices (row * width + col) of the patches holding a change
  cells: number[];
}

export interface PatchGateJobOutput {
  // null when there is nothing to line up: unreadable bytes or different sizes
  gate: PatchGate | null;
}

// postMessage turns Buffers into Uint8Array views over their own ArrayBuffer.
function toBuffer(data: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

export function computePatchGate(input: PatchGateJobInput): PatchGateJobOutput {
  let baseline: PNG;
  let image: PNG;
  try {
    baseline = PNG.sync.read(toBuffer(input.baseline));
    image = PNG.sync.read(toBuffer(input.image));
  } catch {
    return { gate: null };
  }
  const { width, height } = baseline;
  if (image.width !== width || image.height !== height) {
    return { gate: null };
  }
  applyIgnoreAreas(baseline, input.ignoreAreas);
  applyIgnoreAreas(image, input.ignoreAreas);

  // the research's settings, whatever the project's: this asks where the
  // content may have changed, not whether the run fails
  const mask = new PNG({ width, height });
  Pixelmatch(baseline.data, image.data, mask.data, width, height, { threshold: 0.1, includeAA: false, diffMask: true });

  const columns = Math.ceil(width / input.patch);
  const rows = Math.ceil(height / input.patch);
  const marked = new Uint8Array(columns * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask.data[(y * width + x) * 4 + 3] > 0) {
        marked[Math.floor(y / input.patch) * columns + Math.floor(x / input.patch)] = 1;
      }
    }
  }
  const cells: number[] = [];
  marked.forEach((value, index) => value && cells.push(index));
  return { gate: { width: columns, height: rows, cells } };
}
