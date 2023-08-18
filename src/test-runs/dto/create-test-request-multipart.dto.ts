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

  /* eslint-disable @darraghor/nestjs-typed/all-properties-are-whitelisted, @darraghor/nestjs-typed/all-properties-have-explicit-defined */
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

  /* eslint-disable @darraghor/nestjs-typed/api-property-returning-array-should-set-array */
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => (value ? JSON.parse(value) : []))
  ignoreAreas?: IgnoreAreaDto[];
}
