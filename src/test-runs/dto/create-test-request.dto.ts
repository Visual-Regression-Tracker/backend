import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsUUID, IsNumber, IsBoolean, IsBase64 } from 'class-validator';
import { BaselineDataDto } from '../../shared/dto/baseline-data.dto';
import { IgnoreAreaDto } from './ignore-area.dto';

export class CreateTestRequestDto extends BaselineDataDto {
  @ApiProperty()
  @Transform((value) => value.replace(/(\r\n|\n|\r)/gm, ''))
  @IsBase64()
  imageBase64: string;

  @ApiProperty()
  @IsUUID()
  buildId: string;

  @ApiProperty()
  @IsUUID()
  projectId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  diffTollerancePercent?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  merge?: boolean;

  @ApiPropertyOptional({ type: [IgnoreAreaDto] })
  @IsOptional()
  ignoreAreas?: IgnoreAreaDto[];
}
