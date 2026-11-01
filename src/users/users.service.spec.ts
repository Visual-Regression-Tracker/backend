import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { UsersFactoryService } from './users.factory';
import { Role, User } from '@prisma/client';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { randomUUID } from 'crypto';
import { toUserSummary } from './dto/user.dto';
import { UpdateUserDto } from './dto/user-update.dto';
import { OidcUsersService } from './oidc/oidcusers.service';
import { LdapUsersService } from './ldap/ldapusers.service';

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

describe('UsersService with DbUserService implementation', () => {
  let service: UsersService;
  let prismaService: PrismaService;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    configService = { get: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        UsersFactoryService,
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: jest.fn().mockResolvedValueOnce([]),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              findUnique: jest.fn().mockResolvedValueOnce(user),
            },
          },
        },
        {
          provide: AuthService,
          useValue: {
            generateApiKey: jest.fn(() => 'generatedApiKey'),
            encryptPassword: jest.fn(() => 'encryptedPassword'),
            compare: jest.fn(() => true),
            signToken: jest.fn(() => 'token'),
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should generate new api key', async () => {
    const prismaUserUpdateMock = jest.spyOn(prismaService.user, 'update');
    prismaUserUpdateMock.mockResolvedValueOnce(user);

    const result = await service.generateNewApiKey(user);

    expect(prismaUserUpdateMock).toHaveBeenCalled();
    expect(typeof result).toBe('string');
  });

  it('should create a new user', async () => {
    const createUserDto = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      password: 'password123',
    };

    const prismaUserCreateMock = jest.spyOn(prismaService.user, 'create');
    prismaUserCreateMock.mockResolvedValueOnce(user);

    const result = await service.create(createUserDto);

    expect(prismaUserCreateMock).toHaveBeenCalledWith({
      data: {
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        apiKey: 'generatedApiKey',
        password: 'encryptedPassword',
      },
    });
    expect(result).toEqual(expect.any(UserLoginResponseDto));
  });

  it('should update a user', async () => {
    const updateUserDto: UpdateUserDto = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
    };

    const prismaUserUpdateMock = jest.spyOn(prismaService.user, 'update');
    prismaUserUpdateMock.mockResolvedValueOnce(user);

    const result = await service.update(user.id, updateUserDto);

    expect(prismaUserUpdateMock).toHaveBeenCalled();
    expect(result).toEqual(expect.any(UserLoginResponseDto));
  });

  it('should change password', async () => {
    const prismaUserUpdateMock = jest.spyOn(prismaService.user, 'update');
    prismaUserUpdateMock.mockResolvedValueOnce(user);

    const result = await service.changePassword(user, 'newPassword');

    expect(result).toEqual(true);
  });

  it('should login existing user', async () => {
    const result = await service.login({ email: 'test@example.com', password: 'doesntmatter' });

    expect(result).toEqual(expect.any(UserLoginResponseDto));
  });

  it('should delete existing user', async () => {
    const prismaUserDeleteMock = jest.spyOn(prismaService.user, 'delete');
    prismaUserDeleteMock.mockResolvedValueOnce(user);

    await service.delete(user.id);

    expect(prismaUserDeleteMock).toHaveBeenCalledWith({ where: { id: user.id } });
  });

  describe('deleteMany', () => {
    const withTransaction = (found: Pick<User, 'id'>[]) => {
      const tx = { user: { findMany: jest.fn().mockResolvedValueOnce(found), deleteMany: jest.fn() } };
      (prismaService as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((run) => run(tx));
      return tx;
    };

    it('deletes every listed user inside one transaction', async () => {
      const tx = withTransaction([{ id: '1' }, { id: '2' }]);

      await service.deleteMany(['1', '2']);

      expect(tx.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['1', '2'] } }, select: { id: true } });
      expect(tx.user.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['1', '2'] } } });
    });

    it('deletes nobody and names the unknown ids when one is missing', async () => {
      const tx = withTransaction([{ id: '1' }]);

      await expect(service.deleteMany(['1', 'x', 'y'])).rejects.toThrow(new NotFoundException('User not found: x, y'));

      expect(tx.user.deleteMany).not.toHaveBeenCalled();
    });
  });

  it('looks a user up by id', async () => {
    const found = await service.findOne(user.id);

    expect(found).toBe(user);
    expect(prismaService.user.findUnique).toHaveBeenCalledWith({ where: { id: user.id } });
  });

  it('should assign role to user', async () => {
    const assignRoleDto: AssignRoleDto = {
      id: randomUUID(),
      role: Role.editor,
    };

    const prismaUserCreateMock = jest.spyOn(prismaService.user, 'update');
    prismaUserCreateMock.mockResolvedValueOnce(user);

    const result = await service.assignRole(assignRoleDto);

    expect(prismaUserCreateMock).toHaveBeenCalled();
    expect(result).toEqual(toUserSummary(user));
    expect(result).not.toHaveProperty('apiKey');
  });

  it.each([
    [undefined, true],
    ['true', true],
    ['TRUE', true],
    ['yes', true],
    ['', true],
    ['false', false],
    ['0', false],
    [' OFF ', false],
    ['No', false],
  ])('with REGISTRATION_ENABLED %j registration is allowed: %s', (value, allowed) => {
    configService.get.mockImplementation((key: string) => (key === 'REGISTRATION_ENABLED' ? value : undefined));

    expect(service.isRegistrationAllowedByConfig()).toBe(allowed);
    expect(service.isRegistrationEnabled()).toBe(allowed);
  });

  it('reports OIDC as disabled for the DB implementation', () => {
    expect(service.isOidcEnabled()).toBe(false);
  });

  it('rejects OIDC helpers when OIDC is disabled', async () => {
    await expect(service.oidcGetAuthorizationUrl()).rejects.toThrow('OIDC is not enabled.');
  });
});

const serviceWith = async (implementation: object, get = jest.fn()) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      UsersService,
      { provide: UsersFactoryService, useValue: { getUsersService: () => implementation } },
      { provide: PrismaService, useValue: {} },
      { provide: AuthService, useValue: {} },
      { provide: ConfigService, useValue: { get } },
    ],
  }).compile();
  return module.get<UsersService>(UsersService);
};

describe('UsersService with an identity-provider implementation', () => {
  const withoutRegistration = (prototype: object, members: object = {}) =>
    Object.assign(Object.create(prototype), { allowsRegistration: false, ...members });

  it.each([
    ['OIDC', OidcUsersService.prototype, true],
    ['LDAP', LdapUsersService.prototype, false],
  ])('%s: registration is disabled whatever the flag says', async (_name, prototype, oidc) => {
    const service = await serviceWith(
      withoutRegistration(prototype),
      jest.fn(() => 'true')
    );

    expect(service.isRegistrationAllowedByConfig()).toBe(true);
    expect(service.isRegistrationEnabled()).toBe(false);
    expect(service.isOidcEnabled()).toBe(oidc);
  });

  it('delegates authorization url, callback and redirect building to OIDC', async () => {
    const oidcUsersService = withoutRegistration(OidcUsersService.prototype, {
      getAuthorizationUrl: jest.fn(),
      handleCallback: jest.fn(),
      buildFrontendRedirect: jest.fn(),
    }) as OidcUsersService;
    const service = await serviceWith(oidcUsersService);
    const authorization = { url: 'https://idp/authorize', state: 'state', codeVerifier: 'verifier' };
    (oidcUsersService.getAuthorizationUrl as jest.Mock).mockResolvedValue(authorization);
    (oidcUsersService.handleCallback as jest.Mock).mockResolvedValue({ token: 'jwt' });
    (oidcUsersService.buildFrontendRedirect as jest.Mock).mockReturnValue('redirect-url');

    await expect(service.oidcGetAuthorizationUrl()).resolves.toEqual(authorization);
    await expect(
      service.oidcHandleCallback({ code: 'code' }, { state: 'state', codeVerifier: 'verifier' })
    ).resolves.toEqual({ token: 'jwt' });
    expect(service.oidcBuildFrontendRedirect('jwt')).toBe('redirect-url');
  });
});
