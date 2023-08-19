import { ApiProperty } from '@nestjs/swagger';
import { Pagination } from '../../shared/dto/pagination.dto';
import { BuildDto } from './build.dto';

export class PaginatedBuildDto extends Pagination {
  @ApiProperty({ type: BuildDto, isArray: true })
  data: BuildDto[];
}
