import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBase64, IsUUID, IsNumber } from 'class-validator';

export class CreateTestRequestDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsBase64()
  imageBase64: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  os?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  browser?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  viewport?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  device?: string;

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
