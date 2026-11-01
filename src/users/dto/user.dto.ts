import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Role, User } from '@prisma/client';

export class UserDto {
  @ApiProperty()
  readonly id: string;

  @ApiProperty()
  readonly email: string;

  @ApiProperty()
  readonly firstName: string | null;

  @ApiProperty()
  readonly lastName: string | null;

  @ApiProperty()
  readonly apiKey: string;

  @ApiProperty()
  readonly role: Role;

  constructor(user: User) {
    this.id = user.id;
    this.email = user.email;
    this.firstName = user.firstName;
    this.lastName = user.lastName;
    this.apiKey = user.apiKey;
    this.role = user.role;
  }
}

export class UserSummaryDto extends OmitType(UserDto, ['apiKey'] as const) {}

export const toUserSummary = ({ id, email, firstName, lastName, role }: User): UserSummaryDto => ({
  id,
  email,
  firstName,
  lastName,
  role,
});
