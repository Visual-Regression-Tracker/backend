import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UsersFactoryService } from './users.factory';
import { DbUsersService } from './db/dbusers.service';
import { LdapUsersService } from './ldap/ldapusers.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Client } from 'ldapts';
jest.mock('ldapts');

describe('UsersFactoryService', () => {
  let service: UsersFactoryService;
  let configService: ConfigService;

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

  it('should return DbUsersService when LDAP_ENABLED is false', () => {
    jest.spyOn(configService, 'get').mockReturnValue('false');
    const result = service.getUsersService();
    expect(result).toBeInstanceOf(DbUsersService);
  });

  it('should return LdapUsersService when LDAP_ENABLED is true', () => {
    jest.spyOn(configService, 'get').mockReturnValue('true');
    jest.spyOn(configService, 'getOrThrow').mockReturnValue('mockedValue');
    const result = service.getUsersService();
    expect(result).toBeInstanceOf(LdapUsersService);
  });
});
