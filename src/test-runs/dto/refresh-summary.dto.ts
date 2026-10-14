import { ApiProperty } from '@nestjs/swagger';

/**
 * What a refresh did, so the reviewer can be told rather than left guessing
 * why a screen did or did not move.
 */
export class RefreshSummaryDto {
  @ApiProperty({ description: 'Runs compared again, because their variation carries a different baseline now' })
  compared: number;

  @ApiProperty({ description: 'Runs left as they were: their baseline has not moved since the screenshot arrived' })
  unchanged: number;

  @ApiProperty({ description: 'Runs not eligible: already approved or rejected, or their variation is gone' })
  skipped: number;

  @ApiProperty({ description: 'Of those compared, how many no longer differ from their baseline' })
  resolved: number;
}
