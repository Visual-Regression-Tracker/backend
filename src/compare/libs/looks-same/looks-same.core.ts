import looksSame from 'looks-same';
import { PNG } from 'pngjs';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { applyIgnoreAreas, readPng } from '../../utils';
import { LooksSameConfig } from './looks-same.types';

export const LOOKS_SAME_DEFAULT_CONFIG: LooksSameConfig = {
  strict: false,
  ignoreAntialiasing: true,
  ignoreCaret: true,
  allowDiffDimensions: false,
};

export interface LooksSameJobInput {
  kind: 'looks-same';
  baseline: Buffer | Uint8Array;
  image: Buffer | Uint8Array;
  ignoreAreas: IgnoreAreaDto[];
  config: LooksSameConfig;
  saveDiff: boolean;
}

export type LooksSameJobOutput =
  | { outcome: 'baseline-unreadable' }
  | { outcome: 'image-unreadable' }
  | { outcome: 'equal' }
  | { outcome: 'diff-dimension' }
  | {
      outcome: 'compared';
      isSameDimension: boolean;
      result: { equal: boolean; differentPixels?: number; totalPixels?: number } | null;
      diffPng?: Uint8Array;
      errors: string[];
    };

const FAST_PNG = { deflateLevel: 1, filterType: 0 } as const;

export async function computeLooksSame(input: LooksSameJobInput): Promise<LooksSameJobOutput> {
  let baseline: PNG;
  try {
    baseline = readPng(input.baseline);
  } catch {
    return { outcome: 'baseline-unreadable' };
  }
  let image: PNG;
  try {
    image = readPng(input.image);
  } catch {
    return { outcome: 'image-unreadable' };
  }

  const isSameDimension = baseline.width === image.width && baseline.height === image.height;
  if (!isSameDimension && !input.config.allowDiffDimensions) {
    return { outcome: 'diff-dimension' };
  }
  if (isSameDimension && baseline.data.equals(image.data)) {
    return { outcome: 'equal' };
  }

  applyIgnoreAreas(baseline, input.ignoreAreas);
  applyIgnoreAreas(image, input.ignoreAreas);
  const baselinePng = PNG.sync.write(baseline, FAST_PNG);
  const imagePng = PNG.sync.write(image, FAST_PNG);

  const errors: string[] = [];
  const run = (options: LooksSameConfig) => looksSame(baselinePng, imagePng, { ...options, createDiffImage: true });
  let result: looksSame.LooksSameResult<true> | undefined;
  try {
    result = await run(input.config);
  } catch (error) {
    errors.push((error as Error).message, 'Looks-Same cannot compare with the project config, fallback to default one');
    result = await run(LOOKS_SAME_DEFAULT_CONFIG).catch((fallbackError: Error) => {
      errors.push(fallbackError.message);
      return undefined;
    });
  }
  if (!result) {
    return { outcome: 'compared', isSameDimension, result: null, errors };
  }

  const diffPng =
    input.saveDiff && !result.equal && result.diffImage
      ? new Uint8Array(await result.diffImage.createBuffer('png'))
      : undefined;
  return {
    outcome: 'compared',
    isSameDimension,
    result: { equal: result.equal, differentPixels: result.differentPixels, totalPixels: result.totalPixels },
    ...(diffPng ? { diffPng } : {}),
    errors,
  };
}
