import { Test, TestingModule } from '@nestjs/testing';
import { LdapUsersService } from './ldapusers.service';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { HttpException, HttpStatus } from '@nestjs/common';
import { UserLoginResponseDto } from '../dto/user-login-response.dto';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Entry as LdapEntry, Client as LdapClient, SearchOptions, SearchResult } from 'ldapts';

jest.mock('ldapts', () => {
  const mockLdapClient = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    search: jest.fn((_searchDN, searchOptions: SearchOptions): Promise<SearchResult> => {
      if (searchOptions.filter.toString().includes('exists@example.com')) {
        return Promise.resolve({
          searchEntries: [
            {
              dn: 'dn',
              LDAP_ATTRIBUTE_MAIL: 'exists@example.com',
              LDAP_ATTRIBUTE_FIRST_NAME: 'first',
              LDAP_ATTRIBUTE_LAST_NAME: 'last',
            },
          ],
          searchReferences: [],
        });
      } else {
        return Promise.resolve({ searchEntries: [], searchReferences: [] });
      }
    }),
    bind: jest.fn(),
    unbind: jest.fn(),
  };

  return {
    Client: jest.fn(() => mockLdapClient),
  };
});

const user: User = {
  id: '1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  apiKey: 'generatedApiKey',
  password: 'encryptedPassword',
  isActive: true,
  role: Role.editor,
  updatedAt: new Date(),
  createdAt: new Date(),
};

describe('LdapUsersService match from ldap', () => {
  let service: LdapUsersService;
  let prismaService: PrismaService;
  let configService: ConfigService;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('true'),
            getOrThrow: jest.fn((string) => (string === 'LDAP_USERS_SEARCH_FILTER' ? '(&(mail={{email}}))' : string)),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: jest.fn().mockResolvedValueOnce([]),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: AuthService,
          useValue: {
            generateApiKey: jest.fn(() => 'generatedApiKey'),
            encryptPassword: jest.fn(() => 'encryptedPassword'),
            signToken: jest.fn(() => 'token'),
          },
        },
      ],
    }).compile();
    configService = module.get<ConfigService>(ConfigService);
    prismaService = module.get<PrismaService>(PrismaService);
    authService = module.get<AuthService>(AuthService);
    service = new LdapUsersService(configService, prismaService, authService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create new user on login', async () => {
    jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(undefined);
    const prismaUserCreateMock = jest.spyOn(prismaService.user, 'create').mockResolvedValue(user);
    await service.login({ email: 'exists@example.com', password: 'password' });
    expect(prismaUserCreateMock).toHaveBeenCalled();
  });

  it('should login with user already in db', async () => {
    jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(user);
    const prismaUserCreateMock = jest.spyOn(prismaService.user, 'create');
    await service.login({ email: 'exists@example.com', password: 'password' });
    expect(prismaUserCreateMock).not.toHaveBeenCalled();
  });
});

describe('LdapUsersService with no results from ldap', () => {
  let service: LdapUsersService;
  let prismaService: PrismaService;
  let configService: ConfigService;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('true'),
            getOrThrow: jest.fn().mockReturnValue('string'),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: jest.fn().mockResolvedValueOnce([]),
              create: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: AuthService,
          useValue: {
            generateApiKey: jest.fn(() => 'generatedApiKey'),
            encryptPassword: jest.fn(() => 'encryptedPassword'),
          },
        },
      ],
    }).compile();
    configService = module.get<ConfigService>(ConfigService);
    prismaService = module.get<PrismaService>(PrismaService);
    authService = module.get<AuthService>(AuthService);
    service = new LdapUsersService(configService, prismaService, authService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should never change a password', async () => {
    const prismaUserCreateMock = jest.spyOn(prismaService.user, 'create');
    const prismaUserUpdateMock = jest.spyOn(prismaService.user, 'update');
    const result = await service.changePassword(user, 'newPassword');
    expect(prismaUserCreateMock).not.toHaveBeenCalled();
    expect(prismaUserUpdateMock).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('should not login when ldap search results are empty', async () => {
    expect.assertions(1);
    try {
      await service.login({ email: 'testÜ*()\\\0@example.com', password: 'password' });
    } catch (e) {
      expect(e.message).toBe('Invalid email or password.');
    }
  });
});

describe('LdapUsersService characterization', () => {
  let service: LdapUsersService;
  let ldapClient: { search: jest.Mock; bind: jest.Mock; unbind: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } };
  let auth: { generateApiKey: jest.Mock; encryptPassword: jest.Mock; signToken: jest.Mock };

  const config: Record<string, string> = {
    LDAP_URL: 'ldaps://ldap.example.com',
    LDAP_BIND_USER: 'cn=admin',
    LDAP_BIND_PASSWORD: 'admin-secret',
    LDAP_SEARCH_DN: 'ou=people,dc=example,dc=com',
    LDAP_USERS_SEARCH_FILTER: '(|(mail={{email}})(uid={{email}}))',
    LDAP_ATTRIBUTE_MAIL: 'mailAttr',
    LDAP_ATTRIBUTE_FIRST_NAME: 'firstAttr',
    LDAP_ATTRIBUTE_LAST_NAME: 'lastAttr',
  };

  const entry = {
    dn: 'uid=jane,ou=people',
    mailAttr: ' Jane@Example.com ',
    firstAttr: 'Jane',
    lastAttr: 'Roe',
  };

  const createService = (tlsNoVerify = 'false') => {
    const configService = {
      get: jest.fn((key: string, defaultValue: string) => (key === 'LDAP_TLS_NO_VERIFY' ? tlsNoVerify : defaultValue)),
      getOrThrow: jest.fn((key: string) => config[key]),
    };
    return new LdapUsersService(
      configService as unknown as ConfigService,
      prisma as unknown as PrismaService,
      auth as unknown as AuthService
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } };
    auth = {
      generateApiKey: jest.fn().mockReturnValue('generatedApiKey'),
      encryptPassword: jest.fn().mockResolvedValue('encryptedPassword'),
      signToken: jest.fn().mockReturnValue('token'),
    };
    service = createService();
    ldapClient = (service as any).ldapClient;
  });

  it.each([
    ['false', true],
    ['TRUE', false],
  ])('creates the client with LDAP_TLS_NO_VERIFY=%s -> rejectUnauthorized %s', (tlsNoVerify, rejectUnauthorized) => {
    (LdapClient as unknown as jest.Mock).mockClear();

    createService(tlsNoVerify);

    expect(LdapClient).toHaveBeenCalledWith({ url: 'ldaps://ldap.example.com', tlsOptions: { rejectUnauthorized } });
  });

  it('refuses to create users', async () => {
    await expect(
      service.create({ email: 'a@example.com', firstName: 'a', lastName: 'b', password: 'c' })
    ).rejects.toThrow(
      new HttpException('User creation is disabled. Use your LDAP-Credentials to login.', HttpStatus.BAD_REQUEST)
    );
  });

  describe('login', () => {
    it('searches as the bind user with the escaped, trimmed email in every placeholder', async () => {
      ldapClient.search.mockResolvedValueOnce({ searchEntries: [entry], searchReferences: [] });
      prisma.user.findUnique.mockResolvedValueOnce(user);

      await service.login({ email: ' j*ne(x)\\@example.com ', password: 'pw' });

      expect(ldapClient.bind).toHaveBeenNthCalledWith(1, 'cn=admin', 'admin-secret');
      expect(ldapClient.search).toHaveBeenCalledWith('ou=people,dc=example,dc=com', {
        filter: '(|(mail=j\\2ane\\28x\\29\\5c@example.com)(uid=j\\2ane\\28x\\29\\5c@example.com))',
        sizeLimit: 1,
        attributes: ['dn', 'mailAttr', 'firstAttr', 'lastAttr'],
      });
    });

    it('binds as the found user and signs in the existing VRT user by the lower-cased LDAP email', async () => {
      ldapClient.search.mockResolvedValueOnce({ searchEntries: [entry], searchReferences: [] });
      prisma.user.findUnique.mockResolvedValueOnce(user);

      const result = await service.login({ email: 'jane', password: 'pw' });

      expect(ldapClient.bind).toHaveBeenNthCalledWith(2, 'uid=jane,ou=people', 'pw');
      expect(ldapClient.unbind).toHaveBeenCalledTimes(2);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'jane@example.com' } });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(auth.signToken).toHaveBeenCalledWith(user);
      expect(result).toEqual(new UserLoginResponseDto(user, 'token'));
    });

    it('creates an editor with a random password for a user only LDAP knows', async () => {
      ldapClient.search.mockResolvedValueOnce({ searchEntries: [entry], searchReferences: [] });
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValueOnce(user);

      await service.login({ email: 'jane', password: 'pw' });

      expect(auth.encryptPassword).toHaveBeenCalledWith(expect.any(String));
      expect(auth.encryptPassword.mock.calls[0][0]).toHaveLength(12);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'jane@example.com',
          firstName: 'Jane',
          lastName: 'Roe',
          apiKey: 'generatedApiKey',
          password: 'encryptedPassword',
          role: Role.editor,
        },
      });
    });

    it('rejects a wrong password and still unbinds', async () => {
      ldapClient.search.mockResolvedValueOnce({ searchEntries: [entry], searchReferences: [] });
      ldapClient.bind.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('invalid credentials'));

      await expect(service.login({ email: 'jane', password: 'wrong' })).rejects.toThrow(
        new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST)
      );
      expect(ldapClient.unbind).toHaveBeenCalledTimes(2);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it.each(['dn', 'mailAttr', 'firstAttr', 'lastAttr'])(
      'rejects an LDAP entry without the %s attribute',
      async (attribute) => {
        const incomplete = { ...entry, [attribute]: undefined };
        ldapClient.search.mockResolvedValueOnce({ searchEntries: [incomplete], searchReferences: [] });

        await expect(service.login({ email: 'jane', password: 'pw' })).rejects.toThrow(
          new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST)
        );
        expect(ldapClient.bind).toHaveBeenCalledTimes(1);
        expect(ldapClient.unbind).toHaveBeenCalledTimes(1);
      }
    );

    it('passes a failing service bind through and still unbinds', async () => {
      ldapClient.bind.mockRejectedValueOnce(new Error('ldap down'));

      await expect(service.login({ email: 'jane', password: 'pw' })).rejects.toThrow('ldap down');
      expect(ldapClient.search).not.toHaveBeenCalled();
      expect(ldapClient.unbind).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('overwrites the profile with the LDAP entry found for the new email', async () => {
      ldapClient.search.mockResolvedValueOnce({
        searchEntries: [{ ...entry, mail: ' Jane.Roe@Example.com', givenName: 'J.', sn: 'R.' }],
        searchReferences: [],
      });
      prisma.user.update.mockResolvedValueOnce(user);

      const result = await service.update('1', { email: 'jane', firstName: 'ignored', lastName: 'ignored' });

      // NOTE: current behavior — update reads the hard-coded `mail`, `givenName`
      // and `sn` attributes, not the configured LDAP_ATTRIBUTE_* ones login uses
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { email: 'jane.roe@example.com', firstName: 'J.', lastName: 'R.' },
      });
      expect(result).toEqual(new UserLoginResponseDto(user, 'token'));
    });

    it('fails with a TypeError when the entry has no `mail` attribute', async () => {
      ldapClient.search.mockResolvedValueOnce({ searchEntries: [entry], searchReferences: [] });

      await expect(service.update('1', { email: 'jane', firstName: 'a', lastName: 'b' })).rejects.toThrow(TypeError);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
