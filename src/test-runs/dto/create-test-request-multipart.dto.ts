import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { ApiFile } from '../../shared/api-file.decorator';
import { CreateTestRequestDto } from './create-test-request.dto';
import { Transform, Type } from 'class-transformer';
import { IgnoreAreaDto } from './ignore-area.dto';
import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class CreateTestRequestMultipartDto extends OmitType(CreateTestRequestDto, [
  'ignoreAreas',
  'merge',
  'diffTollerancePercent',
]) {
  @ApiFile()
  image: Express.Multer.File;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => parseFloat(value) || 0)
  diffTollerancePercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value == 'true')
  merge?: boolean;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => (value ? JSON.parse(value) : []))
  ignoreAreas?: IgnoreAreaDto[];
}
