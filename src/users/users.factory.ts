import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Users } from './users.interface';
import { DbUsersService } from './db/dbusers.service';
import { LdapUsersService } from './ldap/ldapusers.service';
import { OidcUsersService } from './oidc/oidcusers.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersFactoryService {
  private readonly logger: Logger = new Logger(UsersFactoryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly authService: AuthService
  ) {}

  getUsersService(): Users {
    const oidcEnabled = this.configService.get<string>('OIDC_ENABLED', 'false')?.toLowerCase() === 'true';
    const ldapEnabled = this.configService.get<string>('LDAP_ENABLED', 'false')?.toLowerCase() === 'true';

    if (oidcEnabled && ldapEnabled) {
      this.logger.warn('Both OIDC_ENABLED and LDAP_ENABLED are true. Using OIDC.');
    }

    if (oidcEnabled) {
      this.logger.debug('users service type: OIDC');
      return new OidcUsersService(this.configService, this.prismaService, this.authService);
    }

    if (ldapEnabled) {
      this.logger.debug('users service type: LDAP');
      return new LdapUsersService(this.configService, this.prismaService, this.authService);
    }

    this.logger.debug('users service type: DB');
    return new DbUsersService(this.prismaService, this.authService);
  }
}
