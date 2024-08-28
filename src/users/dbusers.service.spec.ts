import { Test, TestingModule } from '@nestjs/testing';
import { DbUsersService } from './dbusers.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { Role } from '@prisma/client';

describe('DbUsersService', () => {
  let service: DbUsersService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DbUsersService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: jest.fn().mockResolvedValueOnce([]),
              create: jest.fn(),
            },
          },
        },
        {
          provide: AuthService,
          useValue: {
            generateApiKey: jest.fn((..._: any[]) => 'generatedApiKey'),
            encryptPassword: jest.fn((..._: any[]) => 'encryptedPassword'),
          },
        },
      ],
    }).compile();

    service = module.get<DbUsersService>(DbUsersService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
    prismaUserCreateMock.mockResolvedValueOnce({
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
    });

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
});
