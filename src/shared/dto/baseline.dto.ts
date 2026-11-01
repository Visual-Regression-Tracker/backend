import { ApiProperty, OmitType } from '@nestjs/swagger';
import { TestRunDto } from '../../test-runs/dto/testRun.dto';
import { UserDto } from '../../users/dto/user.dto';

export class BaselineUserDto extends OmitType(UserDto, ['apiKey'] as const) {}

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

  @ApiProperty({ type: BaselineUserDto })
  user!: BaselineUserDto | null;
}
