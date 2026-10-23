import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/user-create.dto';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import { UserDto } from './dto/user.dto';
import { UpdateUserDto } from './dto/user-update.dto';
import { AuthService } from '../auth/auth.service';
import { UserLoginRequestDto } from './dto/user-login-request.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { UsersFactoryService } from './users.factory';
import { Users } from './users.interface';
import { OidcUsersService } from './oidc/oidcusers.service';

@Injectable()
export class UsersService {
  private readonly logger: Logger = new Logger(UsersService.name);
  private readonly usersService: Users;

  constructor(
    private readonly usersFactoryService: UsersFactoryService,
    private prismaService: PrismaService,
    private authService: AuthService
  ) {
    this.usersService = this.usersFactoryService.getUsersService();
  }

  async create(createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    return this.usersService.create(createUserDto);
  }

  async update(id: string, userDto: UpdateUserDto): Promise<UserLoginResponseDto> {
    return this.usersService.update(id, userDto);
  }

  async changePassword(user: User, newPassword: string): Promise<boolean> {
    return this.usersService.changePassword(user, newPassword);
  }

  async login(userLoginRequestDto: UserLoginRequestDto) {
    return this.usersService.login(userLoginRequestDto);
  }

  isOidcEnabled(): boolean {
    return this.usersService instanceof OidcUsersService;
  }

  async oidcGetAuthorizationUrl(): Promise<{ url: string; state: string; codeVerifier: string }> {
    return this.oidcUsersService.getAuthorizationUrl();
  }

  async oidcHandleCallback(
    params: Record<string, string>,
    checks: { state: string; codeVerifier: string }
  ): Promise<UserLoginResponseDto> {
    return this.oidcUsersService.handleCallback(params, checks);
  }

  oidcBuildFrontendRedirect(token?: string, error?: string): string {
    return this.oidcUsersService.buildFrontendRedirect(token, error);
  }

  private get oidcUsersService(): OidcUsersService {
    if (!(this.usersService instanceof OidcUsersService)) {
      throw new HttpException('OIDC is not enabled.', HttpStatus.NOT_FOUND);
    }
    return this.usersService;
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
}
