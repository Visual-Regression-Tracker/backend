import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from './user.dto';
import { User } from '@prisma/client';

export class UserLoginResponseDto extends UserDto {
  @ApiProperty()
  token: string;

  constructor(user: User, token?: string) {
    super(user);
    this.token = token;
  }
}
