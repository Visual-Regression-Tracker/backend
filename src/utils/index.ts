import { TestRun, TestVariation } from '@prisma/client';
import { BaselineDataDto } from 'src/shared/dto/baseline-data.dto';

export const getTestVariationUniqueData = (object: TestRun | TestVariation | BaselineDataDto) => {
  return {
    name: object.name,
    os: object.os,
    device: object.device,
    browser: object.browser,
    viewport: object.viewport,
  };
};
