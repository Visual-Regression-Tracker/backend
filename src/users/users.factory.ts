import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Users } from './users.interface';
import { DbUsersService } from './db/dbusers.service';
import { LdapUsersService } from './ldap/ldapusers.service';
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
    const serviceType = this.configService.get<string>('LDAP_ENABLED', 'false')?.toLowerCase() === 'true';
    switch (serviceType) {
      case true:
        this.logger.debug('users service type: LDAP');
        return new LdapUsersService(this.configService, this.prismaService, this.authService);
      case false:
      default:
        this.logger.debug('users service type: DB');
        return new DbUsersService(this.prismaService, this.authService);
    }
  }
}
