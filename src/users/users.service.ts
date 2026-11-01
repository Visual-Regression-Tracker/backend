import { CreateUserDto } from './dto/user-create.dto';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import { UserSummaryDto, toUserSummary } from './dto/user.dto';
import { UpdateUserDto } from './dto/user-update.dto';
import { AuthService } from '../auth/auth.service';
import { UserLoginRequestDto } from './dto/user-login-request.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UsersFactoryService } from './users.factory';
import { Users } from './users.interface';
import { OidcUsersService } from './oidc/oidcusers.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UsersService {
  private readonly logger: Logger = new Logger(UsersService.name);
  private readonly usersService: Users;

  constructor(
    private readonly usersFactoryService: UsersFactoryService,
    private prismaService: PrismaService,
    private authService: AuthService,
    private readonly configService: ConfigService
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

  // default true: switching registration off is the operator's choice, not an upgrade side effect
  isRegistrationAllowedByConfig(): boolean {
    const value = String(this.configService.get('REGISTRATION_ENABLED') ?? 'true')
      .trim()
      .toLowerCase();
    return !['false', '0', 'no', 'off'].includes(value);
  }

  isRegistrationEnabled(): boolean {
    return this.usersService.allowsRegistration && this.isRegistrationAllowedByConfig();
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

  oidcBuildFrontendRedirect(token?: string | null, error?: string): string {
    return this.oidcUsersService.buildFrontendRedirect(token, error);
  }

  private get oidcUsersService(): OidcUsersService {
    if (!(this.usersService instanceof OidcUsersService)) {
      throw new HttpException('OIDC is not enabled.', HttpStatus.NOT_FOUND);
    }
    return this.usersService;
  }

  async findOne(id: string): Promise<User | null> {
    return this.prismaService.user.findUnique({ where: { id } });
  }

  async delete(id: string): Promise<User> {
    this.logger.debug(`Removing User: ${id}`);
    return this.prismaService.user.delete({ where: { id } });
  }

  async deleteMany(ids: string[]): Promise<void> {
    this.logger.debug(`Removing Users: ${ids}`);
    await this.prismaService.$transaction(async (tx) => {
      const found = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
      const missing = ids.filter((id) => !found.some((user) => user.id === id));
      if (missing.length > 0) {
        throw new NotFoundException(`User not found: ${missing.join(', ')}`);
      }
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    });
  }

  async assignRole(data: AssignRoleDto): Promise<UserSummaryDto> {
    const { id, role } = data;
    this.logger.debug(`Assigning role ${role} to User: ${id}`);

    const user = await this.prismaService.user.update({
      where: { id },
      data: { role },
    });
    return toUserSummary(user);
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
