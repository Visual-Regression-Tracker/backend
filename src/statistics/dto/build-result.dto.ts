import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TestStatus } from '@prisma/client';

export class BuildResultDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: Number })
  number!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  ciBuildId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  branchName!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({
    description: 'Number of test runs per status',
    type: 'object',
    properties: Object.fromEntries(Object.values(TestStatus).map((status) => [status, { type: 'number' }])),
  })
  counts!: Record<TestStatus, number>;
}
