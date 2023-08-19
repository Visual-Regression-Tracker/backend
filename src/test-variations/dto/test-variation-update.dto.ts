import { PickType } from '@nestjs/swagger';
import { BaseTestVariationDto } from './base-test-variation.dto';

export class TestVariationUpdateDto extends PickType(BaseTestVariationDto, [
  'baselineName',
  'ignoreAreas',
  'comment',
] as const) {}
