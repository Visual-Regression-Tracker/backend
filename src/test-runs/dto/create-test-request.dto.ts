import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsUUID, IsNumber, IsBoolean, IsString, IsArray, ValidateNested } from 'class-validator';
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
  diffTollerancePercent?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  merge?: boolean;

  @ApiPropertyOptional({ type: IgnoreAreaDto, isArray: true })
  @IsOptional()
  @IsArray()
  @Type(() => IgnoreAreaDto)
  @ValidateNested({ each: true })
  ignoreAreas?: IgnoreAreaDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}
