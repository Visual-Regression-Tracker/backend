import { ApiProperty } from '@nestjs/swagger';
import { TestRunDto } from '../../test-runs/dto/testRun.dto';
import { UserSummaryDto } from '../../users/dto/user.dto';

export class BaselineDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  baselineName!: string;

  @ApiProperty()
  testVariationId!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty()
  testRun!: TestRunDto | null;

  @ApiProperty({ type: UserSummaryDto })
  user!: UserSummaryDto | null;
}
