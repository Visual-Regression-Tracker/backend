import { CreateUserDto } from './dto/user-create.dto';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { User } from '@prisma/client';
import { UserDto } from './dto/user.dto';
import { UpdateUserDto } from './dto/user-update.dto';
import { UserLoginRequestDto } from './dto/user-login-request.dto';
import { AssignRoleDto } from './dto/assign-role.dto';

export abstract class UsersService {
  abstract create(createUserDto: CreateUserDto): Promise<UserLoginResponseDto>;
  abstract findOne(id: string): Promise<User>;
  abstract delete(id: string): Promise<User>;
  abstract get(id: string): Promise<UserDto>;
  abstract assignRole(data: AssignRoleDto): Promise<UserDto>;
  abstract update(id: string, userDto: UpdateUserDto): Promise<UserLoginResponseDto>;
  abstract generateNewApiKey(user: User): Promise<string>;
  abstract changePassword(user: User, newPassword: string): Promise<boolean>;
  abstract login(userLoginRequestDto: UserLoginRequestDto): Promise<UserLoginResponseDto>;
}