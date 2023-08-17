import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CreateUserDto } from './dto/user-create.dto';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import { UserDto } from './dto/user.dto';
import { UpdateUserDto } from './dto/user-update.dto';
import { AuthService } from '../auth/auth.service';
import { UserLoginRequestDto } from './dto/user-login-request.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { Logger } from '@nestjs/common';

@Injectable()
export class UsersService {
  private readonly logger: Logger = new Logger(UsersService.name);

  constructor(
    private prismaService: PrismaService,
    private authService: AuthService
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    const user = {
      email: createUserDto.email.trim().toLowerCase(),
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      apiKey: this.authService.generateApiKey(),
      password: await this.authService.encryptPassword(createUserDto.password),
    };

    const userData = await this.prismaService.user.create({
      data: user,
    });

    return new UserLoginResponseDto(userData, null);
  }

  async findOne(id: string): Promise<User> {
    return this.prismaService.user.findUnique({ where: { id } });
  }

  async delete(id: string): Promise<User> {
    this.logger.debug(`Removing User: ${id}`);
    return this.prismaService.user.delete({ where: { id } });
  }

  async get(id: string): Promise<UserDto> {
    const user = await this.findOne(id);
    return new UserDto(user);
  }

  async assignRole(data: AssignRoleDto): Promise<UserDto> {
    const { id, role } = data;
    this.logger.debug(`Assigning role ${role} to User: ${id}`);

    const user = await this.prismaService.user.update({
      where: { id },
      data: { role },
    });
    return new UserDto(user);
  }

  async update(id: string, userDto: UpdateUserDto): Promise<UserLoginResponseDto> {
    const user = await this.prismaService.user.update({
      where: { id },
      data: {
        email: userDto.email,
        firstName: userDto.firstName,
        lastName: userDto.lastName,
      },
    });
    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
  }

  async generateNewApiKey(user: User): Promise<string> {
    const newApiKey = this.authService.generateApiKey();
    await this.prismaService.user.update({
      where: { id: user.id },
      data: {
        apiKey: newApiKey,
      },
    });
    return newApiKey;
  }

  async changePassword(user: User, newPassword: string): Promise<boolean> {
    await this.prismaService.user.update({
      where: { id: user.id },
      data: {
        password: await this.authService.encryptPassword(newPassword),
      },
    });
    return true;
  }

  async login(userLoginRequestDto: UserLoginRequestDto) {
    const user = await this.prismaService.user.findUnique({
      where: { email: userLoginRequestDto.email },
    });
    if (!user) {
      throw new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST);
    }

    const isMatch = await this.authService.compare(userLoginRequestDto.password, user.password);

    if (!isMatch) {
      throw new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST);
    }

    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
  }
}
