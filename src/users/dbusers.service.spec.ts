import { Test, TestingModule } from '@nestjs/testing';
import { DbUsersService } from './dbusers.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService', () => {
  let service: DbUsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DbUsersService,
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

    service = module.get<DbUsersService>(DbUsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
