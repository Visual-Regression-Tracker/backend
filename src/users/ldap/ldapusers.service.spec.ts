import { LdapUsersService } from './ldapusers.service';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { HttpException, HttpStatus, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { UserLoginResponseDto } from '../dto/user-login-response.dto';
import { Client as LdapClient } from 'ldapts';

jest.mock('ldapts', () => {
  const mockLdapClient = { search: jest.fn(), bind: jest.fn(), unbind: jest.fn().mockResolvedValue(undefined) };
  return { Client: jest.fn(() => mockLdapClient) };
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

describe('LdapUsersService', () => {
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

  const createService = (tlsNoVerify = 'false', overrides: Record<string, string> = {}) => {
    const configService = {
      get: jest.fn((key: string, defaultValue: string) =>
        key === 'LDAP_TLS_NO_VERIFY' ? tlsNoVerify : (overrides[key] ?? defaultValue)
      ),
      getOrThrow: jest.fn((key: string) => config[key]),
    };
    return new LdapUsersService(
      configService as unknown as ConfigService,
      prisma as unknown as PrismaService,
      auth as unknown as AuthService
    );
  };

  const found = () => {
    ldapClient.search.mockResolvedValueOnce({ searchEntries: [entry], searchReferences: [] });
    prisma.user.findUnique.mockResolvedValueOnce(user);
  };
  const login = (svc = service, password = 'pw') => svc.login({ email: 'jane', password });
  const invalidLogin = new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } };
    auth = {
      generateApiKey: jest.fn().mockReturnValue('generatedApiKey'),
      encryptPassword: jest.fn().mockResolvedValue('encryptedPassword'),
      signToken: jest.fn().mockReturnValue('token'),
    };
    service = createService();
    ldapClient = new (LdapClient as unknown as jest.Mock)();
    (LdapClient as unknown as jest.Mock).mockClear();
  });

  it.each([
    ['false', true],
    ['TRUE', false],
  ])(
    'creates the client with LDAP_TLS_NO_VERIFY=%s -> rejectUnauthorized %s',
    async (tlsNoVerify, rejectUnauthorized) => {
      found();

      await login(createService(tlsNoVerify));

      expect(LdapClient).toHaveBeenCalledWith(expect.objectContaining({ tlsOptions: { rejectUnauthorized } }));
    }
  );

  it('passes timeouts to every client', async () => {
    found();

    await login();

    expect(LdapClient).toHaveBeenCalledTimes(2);
    expect(LdapClient).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ url: 'ldaps://ldap.example.com', timeout: 10000, connectTimeout: 5000 })
    );
    expect(LdapClient).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ url: 'ldaps://ldap.example.com', timeout: 10000, connectTimeout: 5000 })
    );
  });

  it('takes the timeouts from LDAP_TIMEOUT_MS and LDAP_CONNECT_TIMEOUT_MS', async () => {
    found();

    await login(createService('false', { LDAP_TIMEOUT_MS: '2500', LDAP_CONNECT_TIMEOUT_MS: '700' }));

    expect(LdapClient).toHaveBeenCalledWith(expect.objectContaining({ timeout: 2500, connectTimeout: 700 }));
  });

  it.each(['0', '-5', 'abc', '1.5', ''])('falls back to the default timeouts for %j', async (value) => {
    found();

    await login(createService('false', { LDAP_TIMEOUT_MS: value, LDAP_CONNECT_TIMEOUT_MS: value }));

    expect(LdapClient).toHaveBeenCalledWith(expect.objectContaining({ timeout: 10000, connectTimeout: 5000 }));
  });

  it('never changes a password', async () => {
    await expect(service.changePassword(user, 'newPassword')).rejects.toThrow(
      new HttpException('Password changes are disabled. Change your password in the directory.', HttpStatus.BAD_REQUEST)
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an email the directory does not know', async () => {
    ldapClient.search.mockResolvedValueOnce({ searchEntries: [], searchReferences: [] });

    await expect(service.login({ email: 'testÜ*()\\\0@example.com', password: 'pw' })).rejects.toThrow(invalidLogin);
  });

  it('refuses to create users', async () => {
    await expect(
      service.create({ email: 'a@example.com', firstName: 'a', lastName: 'b', password: 'c' })
    ).rejects.toThrow(
      new HttpException('User creation is disabled. Use your LDAP-Credentials to login.', HttpStatus.BAD_REQUEST)
    );
  });

  describe('login', () => {
    it.each([
      ['an empty string', ''],
      ['a missing value', undefined as unknown as string],
    ])('rejects %s as the password without contacting LDAP', async (_name, password) => {
      await expect(service.login({ email: 'exists@example.com', password })).rejects.toThrow(invalidLogin);
      expect(ldapClient.bind).not.toHaveBeenCalled();
      expect(ldapClient.search).not.toHaveBeenCalled();
    });

    it('searches as the bind user with the escaped, trimmed email in every placeholder', async () => {
      found();

      await service.login({ email: ' j*ne(x)\\@example.com ', password: 'pw' });

      expect(ldapClient.bind).toHaveBeenNthCalledWith(1, 'cn=admin', 'admin-secret');
      expect(ldapClient.search).toHaveBeenCalledWith('ou=people,dc=example,dc=com', {
        filter: '(|(mail=j\\2ane\\28x\\29\\5c@example.com)(uid=j\\2ane\\28x\\29\\5c@example.com))',
        sizeLimit: 1,
        attributes: ['dn', 'mailAttr', 'firstAttr', 'lastAttr'],
      });
    });

    it('binds as the found user and signs in the existing VRT user by the lower-cased LDAP email', async () => {
      found();

      const result = await login();

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

      await login();

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

      await expect(login(service, 'wrong')).rejects.toThrow(invalidLogin);
      expect(ldapClient.unbind).toHaveBeenCalledTimes(2);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it.each(['dn', 'mailAttr', 'firstAttr', 'lastAttr'])(
      'rejects an LDAP entry without the %s attribute',
      async (attribute) => {
        const incomplete: Partial<typeof entry> = { ...entry, [attribute]: undefined };
        ldapClient.search.mockResolvedValueOnce({ searchEntries: [incomplete], searchReferences: [] });

        await expect(login()).rejects.toThrow(invalidLogin);
        expect(ldapClient.bind).toHaveBeenCalledTimes(1);
        expect(ldapClient.unbind).toHaveBeenCalledTimes(1);
      }
    );

    it('answers 503 when the service bind fails and still unbinds', async () => {
      ldapClient.bind.mockRejectedValueOnce(new Error('ldap down'));

      await expect(login()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(ldapClient.search).not.toHaveBeenCalled();
      expect(ldapClient.unbind).toHaveBeenCalledTimes(1);
    });

    it('answers 503 when the search fails and still unbinds', async () => {
      ldapClient.search.mockRejectedValueOnce(new Error('timeout'));

      await expect(login()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(ldapClient.unbind).toHaveBeenCalledTimes(1);
    });

    it('does not fail the login when unbind throws', async () => {
      found();
      ldapClient.unbind.mockRejectedValue(new Error('socket already closed'));

      await expect(login()).resolves.toEqual(new UserLoginResponseDto(user, 'token'));
      ldapClient.unbind.mockResolvedValue(undefined);
    });
  });

  describe('update', () => {
    const own = { ...user, email: 'exists@example.com' };

    it("refreshes the caller's own LDAP entry and ignores the email sent by the client", async () => {
      prisma.user.findUnique.mockResolvedValueOnce(own);
      ldapClient.search.mockResolvedValueOnce({ searchEntries: [entry], searchReferences: [] });
      prisma.user.update.mockResolvedValueOnce(user);

      const result = await service.update('1', { email: 'cfo@corp.com', firstName: 'x', lastName: 'y' });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: '1' } });
      const filter = ldapClient.search.mock.calls[0][1].filter as string;
      expect(filter).toContain('exists@example.com');
      expect(filter).not.toContain('cfo@corp.com');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { email: 'jane@example.com', firstName: 'Jane', lastName: 'Roe' },
      });
      expect(result).toEqual(new UserLoginResponseDto(user, 'token'));
    });

    it('reads the configured attribute names', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(own);
      ldapClient.search.mockResolvedValueOnce({
        searchEntries: [{ ...entry, mail: 'wrong@example.com', givenName: 'wrong', sn: 'wrong' }],
        searchReferences: [],
      });
      prisma.user.update.mockResolvedValueOnce(user);

      await service.update('1', { email: 'jane', firstName: 'a', lastName: 'b' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { email: 'jane@example.com', firstName: 'Jane', lastName: 'Roe' },
      });
    });

    it('answers 404 when the caller no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.update('1', { email: 'jane', firstName: 'a', lastName: 'b' })).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(ldapClient.search).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('answers 503 when the directory is not reachable', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(own);
      ldapClient.bind.mockRejectedValueOnce(new Error('ldap down'));

      await expect(service.update('1', { email: 'jane', firstName: 'a', lastName: 'b' })).rejects.toBeInstanceOf(
        ServiceUnavailableException
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
