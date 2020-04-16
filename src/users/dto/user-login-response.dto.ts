import { ApiProperty } from '@nestjs/swagger';
import { User } from '../user.entity';
import { UserDto } from './user.dto';

export class UserLoginResponseDto extends UserDto {
  @ApiProperty()
  token: string;

  constructor(user: User, token?: string) {
    super(user);
    this.token = token;
  }
}
