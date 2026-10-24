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
import { UserDto } from './dto/user.dto';
import { UpdateUserDto } from './dto/user-update.dto';
import { OidcUsersService } from './oidc/oidcusers.service';

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        UsersFactoryService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate new api key', async () => {
    // Arrange
    const prismaUserUpdateMock = jest.spyOn(prismaService.user, 'update');
    prismaUserUpdateMock.mockResolvedValueOnce(user);

    // Act
    const result = await service.generateNewApiKey(user);

    // Assert
    expect(prismaUserUpdateMock).toHaveBeenCalled();
    expect(typeof result).toBe('string');
  });

  it('should create a new user', async () => {
    // Arrange
    const createUserDto = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      password: 'password123',
    };

    const prismaUserCreateMock = jest.spyOn(prismaService.user, 'create');
    prismaUserCreateMock.mockResolvedValueOnce(user);

    // Act
    const result = await service.create(createUserDto);

    // Assert
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
    // Arrange
    const updateUserDto: UpdateUserDto = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
    };

    const prismaUserUpdateMock = jest.spyOn(prismaService.user, 'update');
    prismaUserUpdateMock.mockResolvedValueOnce(user);

    // Act
    const result = await service.update(user.id, updateUserDto);

    // Assert
    expect(prismaUserUpdateMock).toHaveBeenCalled();
    expect(result).toEqual(expect.any(UserLoginResponseDto));
  });

  it('should change password', async () => {
    // Arrange
    const prismaUserUpdateMock = jest.spyOn(prismaService.user, 'update');
    prismaUserUpdateMock.mockResolvedValueOnce(user);

    // Act
    const result = await service.changePassword(user, 'newPassword');

    // Assert
    expect(result).toEqual(true);
  });

  it('should login existing user', async () => {
    // Act
    const result = await service.login({ email: 'test@example.com', password: 'doesntmatter' });

    // Assert
    expect(result).toEqual(expect.any(UserLoginResponseDto));
  });

  it('should delete existing user', async () => {
    // Arrange
    const prismaUserDeleteMock = jest.spyOn(prismaService.user, 'delete');
    prismaUserDeleteMock.mockResolvedValueOnce(user);

    // Act
    await service.delete(user.id);

    // Assert
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

  it('should get existing user', async () => {
    // Act
    const result = await service.get(user.id);

    // Assert
    expect(result).toBeInstanceOf(UserDto);
    expect(prismaService.user.findUnique).toHaveBeenCalledWith({ where: { id: user.id } });
  });

  it('looks a user up by id', async () => {
    const found = await service.findOne(user.id);

    expect(found).toBe(user);
    expect(prismaService.user.findUnique).toHaveBeenCalledWith({ where: { id: user.id } });
  });

  it('should assign role to user', async () => {
    // Arrange
    const assignRoleDto: AssignRoleDto = {
      id: randomUUID(),
      role: Role.editor,
    };

    const prismaUserCreateMock = jest.spyOn(prismaService.user, 'update');
    prismaUserCreateMock.mockResolvedValueOnce(user);

    // Act
    const result = await service.assignRole(assignRoleDto);

    // Assert
    expect(prismaUserCreateMock).toHaveBeenCalled();
    expect(result).toBeInstanceOf(UserDto);
  });

  it('reports OIDC as disabled for the DB implementation', () => {
    expect(service.isOidcEnabled()).toBe(false);
  });

  it('rejects OIDC helpers when OIDC is disabled', async () => {
    await expect(service.oidcGetAuthorizationUrl()).rejects.toThrow('OIDC is not enabled.');
  });
});

describe('UsersService with OidcUsersService implementation', () => {
  let service: UsersService;
  let oidcUsersService: OidcUsersService;

  beforeEach(async () => {
    oidcUsersService = Object.assign(Object.create(OidcUsersService.prototype), {
      getAuthorizationUrl: jest.fn(),
      handleCallback: jest.fn(),
      buildFrontendRedirect: jest.fn(),
    }) as OidcUsersService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersFactoryService, useValue: { getUsersService: () => oidcUsersService } },
        { provide: PrismaService, useValue: {} },
        { provide: AuthService, useValue: {} },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('reports OIDC as enabled', () => {
    expect(service.isOidcEnabled()).toBe(true);
  });

  it('delegates authorization url, callback and redirect building', async () => {
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
