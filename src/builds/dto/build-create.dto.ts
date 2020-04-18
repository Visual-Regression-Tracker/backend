import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber } from 'class-validator';

export class CreateBuildDto {
  @ApiProperty()
  @IsString()
  readonly branchName: string;

  @ApiProperty()
  @IsNumber()
  readonly projectId: number;
}
