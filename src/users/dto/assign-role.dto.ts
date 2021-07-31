import { IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class AssignRoleDto {
  @ApiProperty()
  @IsUUID()
  readonly id: string;

  @ApiProperty()
  @IsEnum(Role)
  readonly role: Role;
}
