import { TestRun, TestVariation } from '@prisma/client';
import { BaselineDataDto } from 'src/shared/dto/baseline-data.dto';

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
