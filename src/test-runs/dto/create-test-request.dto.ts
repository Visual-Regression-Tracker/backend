import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsBase64, IsUUID, IsNumber } from 'class-validator';
import { BaselineDataDto } from '../../shared/dto/baseline-data.dto';

export class CreateTestRequestDto extends BaselineDataDto {
  @ApiProperty()
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
}
