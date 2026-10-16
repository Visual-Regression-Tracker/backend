import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UsersFactoryService } from './users.factory';
import { DbUsersService } from './db/dbusers.service';
import { LdapUsersService } from './ldap/ldapusers.service';
import { OidcUsersService } from './oidc/oidcusers.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
jest.mock('ldapts');

describe('UsersFactoryService', () => {
  let service: UsersFactoryService;
  let configService: ConfigService;

  const withFlags = (flags: { oidc?: boolean; ldap?: boolean }) => {
    jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'OIDC_ENABLED') return flags.oidc ? 'true' : 'false';
      if (key === 'LDAP_ENABLED') return flags.ldap ? 'true' : 'false';
      return defaultValue;
    });
    jest.spyOn(configService, 'getOrThrow').mockReturnValue('mockedValue');
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersFactoryService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
            getOrThrow: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: jest.fn().mockResolvedValueOnce([]),
            },
          },
        },
        { provide: AuthService, useValue: {} },
      ],
    }).compile();

    service = module.get<UsersFactoryService>(UsersFactoryService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return DbUsersService when neither OIDC_ENABLED nor LDAP_ENABLED is true', () => {
    withFlags({});
    const result = service.getUsersService();
    expect(result).toBeInstanceOf(DbUsersService);
  });

  it('should return LdapUsersService when LDAP_ENABLED is true', () => {
    withFlags({ ldap: true });
    const result = service.getUsersService();
    expect(result).toBeInstanceOf(LdapUsersService);
  });

  it('should return OidcUsersService when OIDC_ENABLED is true', () => {
    withFlags({ oidc: true });
    const result = service.getUsersService();
    expect(result).toBeInstanceOf(OidcUsersService);
  });

  it('should prefer OidcUsersService when both OIDC_ENABLED and LDAP_ENABLED are true', () => {
    withFlags({ oidc: true, ldap: true });
    const result = service.getUsersService();
    expect(result).toBeInstanceOf(OidcUsersService);
  });
});
