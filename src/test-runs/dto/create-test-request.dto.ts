import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsUUID, IsNumber, IsBoolean } from 'class-validator';
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
  @Transform((it) => parseFloat(it))
  diffTollerancePercent?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  @Transform((it) => {
    switch (it) {
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
  ignoreAreas?: IgnoreAreaDto[];
}
