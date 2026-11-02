import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Client as OidcClient, Issuer, generators, custom, TokenSet } from 'openid-client';
import { CreateUserDto } from '../dto/user-create.dto';
import { UserLoginResponseDto } from '../dto/user-login-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { isPrismaError } from '../../prisma/prisma-errors';
import { Role, User } from '@prisma/client';
import { UpdateUserDto } from '../dto/user-update.dto';
import { AuthService } from '../../auth/auth.service';
import { UserLoginRequestDto } from '../dto/user-login-request.dto';
import { Users } from '../users.interface';
import { ConfigService } from '@nestjs/config';
import { genSaltSync } from 'bcryptjs';
import { Agent as HttpsAgent } from 'node:https';

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
  requireVerifiedEmail: boolean;
};

export class OidcUsersService implements Users {
  readonly allowsRegistration = false;
  private readonly logger: Logger = new Logger(OidcUsersService.name);
  private readonly oidcConfig: OIDCConfig;
  private readonly appFrontendUrl: string;
  private clientPromise: Promise<OidcClient> | null = null;

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
      requireVerifiedEmail:
        this.configService.get<string>('OIDC_REQUIRE_VERIFIED_EMAIL', 'true').toLowerCase() === 'true',
    };
    let appFrontendUrl = this.configService.get<string>('APP_FRONTEND_URL', 'http://localhost:8080');
    while (appFrontendUrl.endsWith('/')) {
      appFrontendUrl = appFrontendUrl.slice(0, -1);
    }
    this.appFrontendUrl = appFrontendUrl;

    if (this.oidcConfig.tlsNoVerify) {
      this.logger.warn('OIDC TLS certificate verification is disabled for the configured issuer only');
    }
  }

  private getHttpOptions(): ((url: URL, options: Record<string, unknown>) => Record<string, unknown>) | null {
    if (!this.oidcConfig.tlsNoVerify) {
      return null;
    }
    const insecureAgent = new HttpsAgent({ rejectUnauthorized: false });
    const issuerOrigin = new URL(this.oidcConfig.issuerUrl).origin;
    return (url, options) => (url.origin === issuerOrigin ? { ...options, agent: insecureAgent } : options);
  }

  private async discoverClient(): Promise<OidcClient> {
    const httpOptions = this.getHttpOptions();
    if (httpOptions) {
      // Discovery only takes a static option; httpOptions still checks the origin
      Issuer[custom.http_options] = httpOptions;
    }

    const issuer = await Issuer.discover(this.oidcConfig.issuerUrl);
    if (httpOptions) {
      issuer[custom.http_options] = httpOptions;
    }
    const client = new issuer.Client({
      client_id: this.oidcConfig.clientId,
      client_secret: this.oidcConfig.clientSecret,
      redirect_uris: [this.oidcConfig.redirectUri],
      response_types: ['code'],
    });

    if (httpOptions) {
      client[custom.http_options] = httpOptions;
    }
    return client;
  }

  private getClient(): Promise<OidcClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.discoverClient().catch((error) => {
        this.clientPromise = null;
        throw error;
      });
    }
    return this.clientPromise;
  }

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

  buildFrontendRedirect(token?: string | null): string {
    const base = `${this.appFrontendUrl}/login`;
    return token ? `${base}#token=${encodeURIComponent(token)}` : `${base}#error=oidc_login_failed`;
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
        Object.assign(claims, await client.userinfo(tokenSet));
      } catch (e) {
        this.logger.warn(`OIDC userinfo request failed: ${e}`);
      }
    }

    const email = this.claimToString(claims, this.oidcConfig.attributeMail)?.trim().toLowerCase();
    if (!email) {
      this.logger.warn(`Attribute '${this.oidcConfig.attributeMail}' not found in OIDC claims`);
      throw new HttpException('OIDC login failed.', HttpStatus.BAD_REQUEST);
    }

    // An unverified email could take over an existing VRT account
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    if (this.oidcConfig.requireVerifiedEmail && !emailVerified) {
      this.logger.warn(`OIDC login rejected: email '${email}' is not verified by the identity provider`);
      throw new HttpException('OIDC login failed.', HttpStatus.BAD_REQUEST);
    }

    const role = this.resolveRole(claims);
    // Without the claim the provider says nothing about roles: keep existing ones rather than demote every admin
    const hasRoleClaim = this.readRoleClaim(claims) != null;

    let user = await this.prismaService.user.findUnique({ where: { email } });

    if (!user) {
      this.logger.log(`'${email}' authenticated via OIDC but not found in VRT database. Creating user.`);
      user = await this.createUserFromClaimsOrFindConcurrent(claims, email, role);
    } else if (!hasRoleClaim) {
      this.logger.warn(`Claim '${this.oidcConfig.roleClaim}' not found for '${email}'. Keeping role '${user.role}'.`);
    } else if (user.role !== role) {
      this.logger.log(`Updating role of '${email}' from '${user.role}' to '${role}' based on OIDC claims.`);
      user = await this.prismaService.user.update({ where: { id: user.id }, data: { role } });
    }

    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
  }

  private async createUserFromClaimsOrFindConcurrent(
    claims: Record<string, unknown>,
    email: string,
    role: Role
  ): Promise<User> {
    try {
      return await this.createUserFromClaims(claims, email, role);
    } catch (e) {
      if (!isPrismaError(e, 'P2002')) {
        throw e;
      }
      const user = await this.prismaService.user.findUnique({ where: { email } });
      if (!user) {
        throw e;
      }
      return user;
    }
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
    return this.scalarToString(this.toArray(claims[name])[0]);
  }

  private toArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }
    return value == null ? [] : [value];
  }

  private scalarToString(value: unknown): string | null {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return null;
  }

  private readRoleClaim(claims: Record<string, unknown>): unknown {
    const name = this.oidcConfig.roleClaim;
    if (claims[name] != null) {
      return claims[name];
    }
    return name
      .split('.')
      .reduce<unknown>(
        (value, key) =>
          value != null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
        claims
      );
  }

  private resolveRole(claims: Record<string, unknown>): Role {
    const raw = this.readRoleClaim(claims);
    const values = this.toArray(raw)
      .flatMap((value) => (this.scalarToString(value) ?? '').split(/[\s,]+/))
      .filter((value) => value.length > 0)
      .map((value) => value.toLowerCase());
    const isAdmin = values.some((value) => this.oidcConfig.adminValues.includes(value));
    return isAdmin ? Role.admin : this.oidcConfig.defaultRole;
  }

  create(_createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    return Promise.reject(new HttpException('User creation is disabled. Use SSO to login.', HttpStatus.BAD_REQUEST));
  }

  async update(id: string, userDto: UpdateUserDto): Promise<UserLoginResponseDto> {
    const user = await this.prismaService.user.update({
      where: { id },
      data: {
        firstName: userDto.firstName,
        lastName: userDto.lastName,
      },
    });
    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
  }

  changePassword(user: User, _newPassword: string): Promise<boolean> {
    this.logger.warn(`${user.email} tried to change password - this is not supported for OIDC users`);
    return Promise.reject(
      new HttpException('Password changes are disabled. Use SSO to change your password.', HttpStatus.BAD_REQUEST)
    );
  }

  login(_userLoginRequestDto: UserLoginRequestDto): Promise<UserLoginResponseDto> {
    return Promise.reject(new HttpException('Password login is disabled. Use SSO to login.', HttpStatus.BAD_REQUEST));
  }
}
