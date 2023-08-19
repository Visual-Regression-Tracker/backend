import { ApiProperty } from '@nestjs/swagger';
import { Pagination } from '../../shared/dto/pagination.dto';
import { TestRunDto } from './testRun.dto';

export class PaginatedTestRunDto extends Pagination {
  @ApiProperty({ type: TestRunDto, isArray: true })
  data: TestRunDto[];
}
