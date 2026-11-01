import { TestRun, TestVariation } from '@prisma/client';
import { BaselineDataDto } from '../shared/dto/baseline-data.dto';
import type { IgnoreAreaDto } from '../test-runs/dto/ignore-area.dto';

export const getTestVariationUniqueData = (
  object: TestRun | TestVariation | BaselineDataDto
): {
  name: string;
  os: string;
  device: string;
  browser: string;
  viewport: string;
  customTags: string;
} => {
  return {
    name: object.name,
    os: object.os ?? '',
    device: object.device ?? '',
    browser: object.browser ?? '',
    viewport: object.viewport ?? '',
    customTags: object.customTags ?? '',
  };
};

export const variationKey = (
  projectId: string,
  branchName: string,
  source: TestRun | TestVariation | BaselineDataDto
): ReturnType<typeof getTestVariationUniqueData> & { projectId: string; branchName: string } => ({
  projectId,
  branchName,
  ...getTestVariationUniqueData(source),
});

export const testRunImageNames = (
  run: Pick<TestRun, 'imageName' | 'diffName' | 'imageThumbnailName' | 'diffThumbnailName'>
): string[] =>
  [run.imageName, run.diffName, run.imageThumbnailName, run.diffThumbnailName].filter((name): name is string => !!name);

export const parseIgnoreAreas = (json: string | null | undefined): IgnoreAreaDto[] => {
  if (!json) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((area): area is IgnoreAreaDto => typeof area === 'object' && area !== null)
      : [];
  } catch {
    return [];
  }
};
