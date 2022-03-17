import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsUUID, IsNumber, IsBoolean } from 'class-validator';
import { isArray } from 'lodash';
import { BaselineDataDto } from '../../shared/dto/baseline-data.dto';
import { IgnoreAreaDto } from './ignore-area.dto';

export class CreateTestRequestDto extends BaselineDataDto {
  @ApiProperty()
  @IsUUID()
  buildId: string;

  @ApiProperty()
  @IsUUID()
  projectId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Transform(({value}) => parseFloat(value))
  diffTollerancePercent?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  @Transform(({value}) => {
    switch (value) {
      case 'true':
        return true;
      case 'false':
        return false;
      default:
        return it;
    }
  })
  merge?: boolean;

  @ApiPropertyOptional({ type: [IgnoreAreaDto] })
  @IsOptional()
  @Transform(({value}) => {
    if (isArray(value)) {
      return it;
    }
    return JSON.parse(value);
  })
  ignoreAreas?: IgnoreAreaDto[];
}
