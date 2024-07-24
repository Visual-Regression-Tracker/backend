import { Module, DynamicModule } from '@nestjs/common';
import { LdapUsersService } from './ldapusers.service';
import { DbUsersService } from './dbusers.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { UsersService } from './users.service';

@Module({})
export class UsersModule {
  static register(): DynamicModule {
    const providers = [
      PrismaService,
      {
        provide: UsersService,
        useFactory: (prismaService: PrismaService, authService: AuthService) => {
          if (process.env.LDAP_ENABLED === 'true') {
            return new LdapUsersService(prismaService, authService);
          } else {
            return new DbUsersService(prismaService, authService);
          }
        },
        inject: [PrismaService, AuthService],
      },
    ];

    return {
      module: UsersModule,
      providers: providers,
      exports: [UsersService],
      imports: [AuthModule],
      controllers: [UsersController],
    };
  }
}
