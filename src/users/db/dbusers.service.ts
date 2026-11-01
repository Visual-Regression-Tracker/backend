import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from '../dto/user-create.dto';
import { UserLoginResponseDto } from '../dto/user-login-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { User } from '@prisma/client';
import { UpdateUserDto } from '../dto/user-update.dto';
import { AuthService } from '../../auth/auth.service';
import { UserLoginRequestDto } from '../dto/user-login-request.dto';
import { Users } from '../users.interface';

export class DbUsersService implements Users {
  readonly allowsRegistration = true;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authService: AuthService
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

  async update(id: string, userDto: UpdateUserDto): Promise<UserLoginResponseDto> {
    const current = await this.prismaService.user.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException(`User not found: ${id}`);
    }
    const requested = userDto.email.trim();
    // a case-only difference keeps the stored spelling: lower-casing it could collide with another row
    const email = requested.toLowerCase() === current.email.toLowerCase() ? current.email : requested.toLowerCase();
    const user = await this.prismaService.user.update({
      where: { id },
      data: {
        email,
        firstName: userDto.firstName,
        lastName: userDto.lastName,
      },
    });
    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
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
    const email = userLoginRequestDto.email.trim();
    // rows saved before emails were lower-cased keep their spelling, so the exact match goes first
    const user =
      (await this.prismaService.user.findUnique({ where: { email } })) ??
      (email === email.toLowerCase()
        ? null
        : await this.prismaService.user.findUnique({ where: { email: email.toLowerCase() } }));
    if (!user || !(await this.authService.compare(userLoginRequestDto.password, user.password))) {
      throw new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST);
    }

    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
  }
}
