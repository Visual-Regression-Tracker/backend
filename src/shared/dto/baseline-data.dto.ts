import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class BaselineDataDto {
  @ApiProperty()
  @IsString()
  name: string;

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
  @IsString()
  branchName: string;
}

export const convertBaselineDataToQuery = (data: BaselineDataDto) => {
  return {
    name: data.name,
    branchName: data.branchName,
    os: data.os ? data.os : null,
    browser: data.browser ? data.browser : null,
    device: data.device ? data.device : null,
    viewport: data.viewport ? data.viewport : null,
  };
};
