import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsBase64 } from 'class-validator';

export class CreateTestRequestDto {
  @ApiProperty()
  @IsString()
  readonly name: string;

  @ApiProperty()
  @IsBase64()
  readonly imageBase64: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  readonly os: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  readonly browser: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  readonly viewport: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  readonly device: string;

  @ApiProperty()
  @IsNumber()
  readonly buildId: number;
}
