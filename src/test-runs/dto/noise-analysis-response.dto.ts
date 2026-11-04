import { ApiProperty } from '@nestjs/swagger';
import { NoiseEnqueueResult, NoiseSkipReason } from '../../compare/noise-hint/noise-hint.service';

export class NoiseAnalysisSkippedDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['not unresolved', 'analysis off', 'queue full'] })
  reason!: NoiseSkipReason;
}

export class NoiseAnalysisResponseDto implements NoiseEnqueueResult {
  @ApiProperty()
  queued!: number;

  @ApiProperty({ type: NoiseAnalysisSkippedDto, isArray: true })
  skipped!: NoiseAnalysisSkippedDto[];
}
