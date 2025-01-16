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
    expect(prismaUserDeleteMock).toHaveBeenCalled();
  });

  it('should get existing user', async () => {
    // Act
    const result = await service.get(user.id);

    // Assert
    expect(result).toBeInstanceOf(UserDto);
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
});
