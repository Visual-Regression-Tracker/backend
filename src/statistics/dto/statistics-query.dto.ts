import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class StatisticsQueryDto {
  @ApiProperty()
  @IsUUID()
  projectId!: string;

  @ApiPropertyOptional({ description: 'All branches when omitted' })
  @IsOptional()
  @IsString()
  branchName?: string;
}
