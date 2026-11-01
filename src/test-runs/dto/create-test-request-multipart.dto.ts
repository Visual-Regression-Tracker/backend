import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { ApiFile } from '../../shared/api-file.decorator';
import { CreateTestRequestDto } from './create-test-request.dto';
import { plainToInstance, Transform } from 'class-transformer';
import { IgnoreAreaDto } from './ignore-area.dto';
import { ValidationOptions } from '../../shared/validation';
import { IsArray, IsBoolean, IsDefined, IsNumber, IsObject, IsOptional, ValidateNested } from 'class-validator';

const parseIgnoreAreas = (value: unknown): unknown => {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  return Array.isArray(value)
    ? value.map((item) => (item !== null && typeof item === 'object' ? plainToInstance(IgnoreAreaDto, item) : item))
    : value;
};

@ValidationOptions({ transform: true, forbidUnknownValues: true })
export class CreateTestRequestMultipartDto extends OmitType(CreateTestRequestDto, [
  'ignoreAreas',
  'merge',
  'diffTollerancePercent',
]) {
  @ApiFile()
  @IsDefined()
  @IsObject()
  image!: Express.Multer.File;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => parseFloat(value) || 0, { toClassOnly: true })
  diffTollerancePercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true', { toClassOnly: true })
  merge?: boolean;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Transform(({ value }) => parseIgnoreAreas(value), { toClassOnly: true })
  ignoreAreas?: IgnoreAreaDto[];
}
