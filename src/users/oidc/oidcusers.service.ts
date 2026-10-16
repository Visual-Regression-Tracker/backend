import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Client as OidcClient, Issuer, generators, custom, TokenSet } from 'openid-client';
import { CreateUserDto } from '../dto/user-create.dto';
import { UserLoginResponseDto } from '../dto/user-login-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { Role, User } from '@prisma/client';
import { UpdateUserDto } from '../dto/user-update.dto';
import { AuthService } from '../../auth/auth.service';
import { UserLoginRequestDto } from '../dto/user-login-request.dto';
import { Users } from '../users.interface';
import { ConfigService } from '@nestjs/config';
import { genSaltSync } from 'bcryptjs';
import { Agent as HttpsAgent } from 'https';

type OIDCConfig = {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  attributeMail: string;
  attributeFirstName: string;
  attributeLastName: string;
  roleClaim: string;
  adminValues: string[];
  defaultRole: Role;
  tlsNoVerify: boolean;
};

export class OidcUsersService implements Users {
  private readonly logger: Logger = new Logger(OidcUsersService.name);
  private readonly oidcConfig: OIDCConfig;
  private readonly appFrontendUrl: string;
  private client: OidcClient | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly authService: AuthService
  ) {
    this.oidcConfig = {
      issuerUrl: this.configService.getOrThrow<string>('OIDC_ISSUER_URL'),
      clientId: this.configService.getOrThrow<string>('OIDC_CLIENT_ID'),
      clientSecret: this.configService.getOrThrow<string>('OIDC_CLIENT_SECRET'),
      redirectUri: this.configService.get<string>('OIDC_REDIRECT_URI', 'http://localhost:4200/users/oidc/callback'),
      scopes: this.configService.get<string>('OIDC_SCOPES', 'openid profile email'),
      attributeMail: this.configService.get<string>('OIDC_ATTRIBUTE_MAIL', 'email'),
      attributeFirstName: this.configService.get<string>('OIDC_ATTRIBUTE_FIRST_NAME', 'given_name'),
      attributeLastName: this.configService.get<string>('OIDC_ATTRIBUTE_LAST_NAME', 'family_name'),
      roleClaim: this.configService.get<string>('OIDC_ROLE_CLAIM', 'groups'),
      adminValues: this.configService
        .get<string>('OIDC_ADMIN_VALUES', 'vrt-admin,admin')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
      defaultRole:
        this.configService.get<string>('OIDC_DEFAULT_ROLE', 'editor').toLowerCase() === 'admin'
          ? Role.admin
          : Role.editor,
      tlsNoVerify: this.configService.get<string>('OIDC_TLS_NO_VERIFY', 'false').toLowerCase() === 'true',
    };
    this.appFrontendUrl = this.configService
      .get<string>('APP_FRONTEND_URL', 'http://localhost:8080')
      .replace(/\/+$/, '');

    if (this.oidcConfig.tlsNoVerify) {
      this.logger.warn('OIDC TLS certificate verification is disabled');
      custom.setHttpOptionsDefaults({ agent: new HttpsAgent({ rejectUnauthorized: false }) });
    }
  }

  private async getClient(): Promise<OidcClient> {
    if (this.client) {
      return this.client;
    }
    const issuer = await Issuer.discover(this.oidcConfig.issuerUrl);
    this.client = new issuer.Client({
      client_id: this.oidcConfig.clientId,
      client_secret: this.oidcConfig.clientSecret,
      redirect_uris: [this.oidcConfig.redirectUri],
      response_types: ['code'],
    });
    return this.client;
  }

  /**
   * Builds the IdP authorization URL together with the PKCE/state values that
   * must be kept (e.g. in a short-lived cookie) until the callback returns.
   */
  async getAuthorizationUrl(): Promise<{ url: string; state: string; codeVerifier: string }> {
    const client = await this.getClient();
    const state = generators.state();
    const codeVerifier = generators.codeVerifier();
    const url = client.authorizationUrl({
      scope: this.oidcConfig.scopes,
      state,
      code_challenge: generators.codeChallenge(codeVerifier),
      code_challenge_method: 'S256',
    });
    return { url, state, codeVerifier };
  }

  /**
   * URL the browser is redirected to after OIDC finished (success or error).
   * The token travels in the URL fragment so it never reaches server logs.
   */
  buildFrontendRedirect(token?: string, error?: string): string {
    const base = `${this.appFrontendUrl}/login`;
    if (token) {
      return `${base}#token=${encodeURIComponent(token)}`;
    }
    return `${base}#error=${encodeURIComponent(error ?? 'oidc_login_failed')}`;
  }

  async handleCallback(
    params: Record<string, string>,
    checks: { state: string; codeVerifier: string }
  ): Promise<UserLoginResponseDto> {
    const client = await this.getClient();

    let tokenSet: TokenSet;
    try {
      tokenSet = await client.callback(this.oidcConfig.redirectUri, params, {
        state: checks.state,
        code_verifier: checks.codeVerifier,
      });
    } catch (e) {
      this.logger.warn(`OIDC callback validation failed: ${e}`);
      throw new HttpException('OIDC login failed.', HttpStatus.BAD_REQUEST);
    }

    const claims: Record<string, unknown> = { ...tokenSet.claims() };
    if (tokenSet.access_token && !this.claimToString(claims, this.oidcConfig.attributeMail)) {
      try {
        Object.assign(claims, await client.userinfo(tokenSet.access_token));
      } catch (e) {
        this.logger.warn(`OIDC userinfo request failed: ${e}`);
      }
    }

    const email = this.claimToString(claims, this.oidcConfig.attributeMail)?.trim().toLowerCase();
    if (!email) {
      this.logger.warn(`Attribute '${this.oidcConfig.attributeMail}' not found in OIDC claims`);
      throw new HttpException('OIDC login failed.', HttpStatus.BAD_REQUEST);
    }

    const role = this.resolveRole(claims);

    let user = await this.prismaService.user.findUnique({ where: { email } });

    if (!user) {
      this.logger.log(`'${email}' authenticated via OIDC but not found in VRT database. Creating user.`);
      user = await this.createUserFromClaims(claims, email, role);
    } else if (user.role !== role) {
      this.logger.log(`Updating role of '${email}' from '${user.role}' to '${role}' based on OIDC claims.`);
      user = await this.prismaService.user.update({ where: { id: user.id }, data: { role } });
    }

    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
  }

  private async createUserFromClaims(claims: Record<string, unknown>, email: string, role: Role): Promise<User> {
    const userForVRTDb = {
      email,
      firstName: this.claimToString(claims, this.oidcConfig.attributeFirstName) ?? email,
      lastName: this.claimToString(claims, this.oidcConfig.attributeLastName) ?? '',
      apiKey: this.authService.generateApiKey(),
      password: await this.authService.encryptPassword(genSaltSync(1).slice(-12)),
      role,
    };

    return this.prismaService.user.create({ data: userForVRTDb });
  }

  private claimToString(claims: Record<string, unknown>, name: string): string | null {
    const value = claims[name];
    if (value == null) {
      return null;
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? value[0].toString() : null;
    }
    return value.toString();
  }

  private resolveRole(claims: Record<string, unknown>): Role {
    const raw = claims[this.oidcConfig.roleClaim];
    const values = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
      .flatMap((value) => value.toString().split(/[\s,]+/))
      .filter((value) => value.length > 0)
      .map((value) => value.toLowerCase());
    const isAdmin = values.some((value) => this.oidcConfig.adminValues.includes(value));
    return isAdmin ? Role.admin : this.oidcConfig.defaultRole;
  }

  async create(createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    throw new HttpException('User creation is disabled. Use SSO to login.', HttpStatus.BAD_REQUEST);
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

  async changePassword(user: User, newPassword: string): Promise<boolean> {
    this.logger.warn(`${user.email} tried to change password - this is not supported for OIDC users`);
    return true;
  }

  async login(userLoginRequestDto: UserLoginRequestDto): Promise<UserLoginResponseDto> {
    throw new HttpException('Password login is disabled. Use SSO to login.', HttpStatus.BAD_REQUEST);
  }
}
