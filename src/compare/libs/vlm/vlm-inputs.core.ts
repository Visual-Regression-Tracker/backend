import { PNG } from 'pngjs';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { applyIgnoreAreas, readPng } from '../../utils';

export interface VlmInputsJobInput {
  kind: 'vlm-inputs';
  baseline: Buffer | Uint8Array;
  image: Buffer | Uint8Array;
  ignoreAreas: IgnoreAreaDto[];
}

export interface VlmInputsJobOutput {
  baseline: Uint8Array | null;
  image: Uint8Array | null;
}

const masked = (bytes: Buffer | Uint8Array, ignoreAreas: IgnoreAreaDto[]): Uint8Array | null => {
  let png: PNG;
  try {
    png = readPng(bytes);
  } catch {
    return null;
  }
  return new Uint8Array(PNG.sync.write(applyIgnoreAreas(png, ignoreAreas), { filterType: 1 }));
};

export function computeVlmInputs(input: VlmInputsJobInput): VlmInputsJobOutput {
  return { baseline: masked(input.baseline, input.ignoreAreas), image: masked(input.image, input.ignoreAreas) };
}
