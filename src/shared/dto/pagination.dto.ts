import { ApiProperty } from '@nestjs/swagger';

export class Pagination {
  @ApiProperty()
  take: number;
  @ApiProperty()
  skip: number;
  @ApiProperty()
  total: number;
}
