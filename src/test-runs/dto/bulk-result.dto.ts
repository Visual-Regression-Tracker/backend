import { ApiProperty } from '@nestjs/swagger';

export class BulkFailureDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  message!: string;
}

export class BulkResultDto {
  @ApiProperty({ type: String, isArray: true })
  succeeded!: string[];

  @ApiProperty({ type: BulkFailureDto, isArray: true })
  failed!: BulkFailureDto[];
}
