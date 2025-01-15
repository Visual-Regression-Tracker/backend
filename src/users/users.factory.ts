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
    private configService: ConfigService,
    private prismaService: PrismaService,
    private authService: AuthService
  ) {}

  getUsersService(): Users {
    const serviceType = this.configService.get<boolean>('LDAP_ENABLED', false);
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
