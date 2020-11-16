import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class CreateBuildDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly ciBuildId?: string;

  @ApiProperty()
  @IsString()
  readonly branchName: string;

  @ApiProperty()
  @IsString()
  readonly project: string;
}
