import { Controller, Post, Body, Get, UseGuards, Put, Delete, Patch, Req, Res, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { UsersService } from './users.service';
import { ApiOkResponse, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { CreateUserDto } from './dto/user-create.dto';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { UserDto } from './dto/user.dto';
import { UpdateUserDto } from './dto/user-update.dto';
import { UserLoginRequestDto } from './dto/user-login-request.dto';
import { CurrentUser } from '../shared/current-user.decorator';
import { Role, User } from '@prisma/client';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../shared/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const OIDC_STATE_COOKIE = 'oidc_state';

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

@Controller('users')
@ApiTags('users')
export class UsersController {
  private readonly logger: Logger = new Logger(UsersController.name);

  constructor(
    private usersService: UsersService,
    private prismaService: PrismaService,
    private configService: ConfigService
  ) {}

  @Post('register')
  @ApiOkResponse({ type: UserLoginResponseDto })
  register(@Body() createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    return this.usersService.create(createUserDto);
  }

  @Post('login')
  @ApiOkResponse({ type: UserLoginResponseDto })
  async login(@Body() userLoginRequestDto: UserLoginRequestDto): Promise<UserLoginResponseDto> {
    return this.usersService.login(userLoginRequestDto);
  }

  @Get('oidc/enabled')
  @ApiOkResponse({ type: Boolean })
  oidcEnabled(): boolean {
    return this.usersService.isOidcEnabled();
  }

  @Get('oidc/login')
  async oidcLogin(@Res() res: Response): Promise<void> {
    if (!this.usersService.isOidcEnabled()) {
      res.status(HttpStatus.NOT_FOUND).send('OIDC is not enabled.');
      return;
    }

    let authorization: { url: string; state: string; codeVerifier: string };
    try {
      authorization = await this.usersService.oidcGetAuthorizationUrl();
    } catch (e) {
      // The browser navigated here directly, so send it back to the login page
      // instead of showing a raw JSON error (e.g. when discovery fails).
      this.logger.warn(`OIDC login failed: ${e?.message ?? e}`);
      res.redirect(this.usersService.oidcBuildFrontendRedirect(undefined, 'oidc_login_failed'));
      return;
    }
    const { url, state, codeVerifier } = authorization;
    res.cookie(OIDC_STATE_COOKIE, `${state}.${codeVerifier}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.configService.get<string>('OIDC_REDIRECT_URI', '').startsWith('https'),
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
    res.redirect(url);
  }

  @Get('oidc/callback')
  async oidcCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.usersService.isOidcEnabled()) {
      res.status(HttpStatus.NOT_FOUND).send('OIDC is not enabled.');
      return;
    }

    let target = this.usersService.oidcBuildFrontendRedirect(undefined, 'oidc_login_failed');
    try {
      // Inside the try: decodeURIComponent throws on a malformed cookie value.
      const [state, codeVerifier] = (readCookie(req, OIDC_STATE_COOKIE) ?? '').split('.');
      if (!state || !codeVerifier) {
        throw new Error('Missing or malformed OIDC state cookie.');
      }
      // Repeated query keys produce arrays; keep only scalar strings so the
      // callback sees a plain parameter map.
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string') {
          params[key] = value;
        }
      }
      const { token } = await this.usersService.oidcHandleCallback(params, {
        state,
        codeVerifier,
      });
      target = this.usersService.oidcBuildFrontendRedirect(token);
    } catch (e) {
      this.logger.warn(`OIDC callback failed: ${e?.message ?? e}`);
    } finally {
      res.clearCookie(OIDC_STATE_COOKIE, { path: '/' });
    }
    res.redirect(target);
  }

  @Get('me')
  @ApiOkResponse({ type: UserDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: User): UserDto {
    return new UserDto(user);
  }

  @Get('newApiKey')
  @ApiOkResponse({ type: String })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  generateNewApiKey(@CurrentUser() user: User): Promise<string> {
    return this.usersService.generateNewApiKey(user);
  }

  @Put('password')
  @ApiOkResponse({ type: Boolean })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  changePassword(@CurrentUser() user: User, @Body('password') password: string): Promise<boolean> {
    return this.usersService.changePassword(user, password);
  }

  @Put()
  @ApiOkResponse({ type: UserLoginResponseDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() user: User, @Body() updateUserDto: UpdateUserDto): Promise<UserLoginResponseDto> {
    return this.usersService.update(user.id, updateUserDto);
  }

  @Get('all')
  @ApiOkResponse({ type: UserDto, isArray: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin)
  async userList(): Promise<UserDto[]> {
    const users = await this.prismaService.user.findMany();
    return users.map((user) => new UserDto(user));
  }

  @Delete()
  @ApiOkResponse({ type: Boolean })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin)
  async delete(@Body() ids: string[]): Promise<void> {
    this.logger.debug(`Going to remove User: ${ids}`);
    await this.usersService.deleteMany(ids);
  }

  @Patch('assignRole')
  @ApiOkResponse({ type: UserDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin)
  async assignRole(@Body() data: AssignRoleDto): Promise<UserDto> {
    this.logger.debug(`Going to assign role ${data.role} to User: ${data.id}`);
    return this.usersService.assignRole(data);
  }
}
