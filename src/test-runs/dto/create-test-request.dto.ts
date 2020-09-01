import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsUUID, IsNumber, IsBoolean, IsBase64 } from 'class-validator';
import { BaselineDataDto } from '../../shared/dto/baseline-data.dto';

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

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  diffTollerancePercent?: number;

  @ApiProperty()
  @IsBoolean()
  @IsOptional()
  merge?: boolean;
}
