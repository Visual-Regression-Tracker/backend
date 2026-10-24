import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from './user.dto';
import { User } from '@prisma/client';

export class UserLoginResponseDto extends UserDto {
  @ApiProperty()
  token: string | null;

  constructor(user: User, token: string | null) {
    super(user);
    this.token = token;
  }
}
