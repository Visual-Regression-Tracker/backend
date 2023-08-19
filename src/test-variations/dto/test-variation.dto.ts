import { ApiProperty } from '@nestjs/swagger';
import { BaseTestVariationDto } from './base-test-variation.dto';
import { BaselineDto } from '../../shared/dto/baseline.dto';

export class TestVariationDto extends BaseTestVariationDto {
  @ApiProperty({ type: BaselineDto, isArray: true })
  baselines: BaselineDto[];
}
