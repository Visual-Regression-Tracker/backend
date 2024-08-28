import { Test, TestingModule } from '@nestjs/testing';
import { LdapUsersService } from './ldapusers.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserLoginResponseDto } from './dto/user-login-response.dto';

describe('LdapUsersService', () => {
  let service: LdapUsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LdapUsersService,
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

    service = module.get<LdapUsersService>(LdapUsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  xit('login using ldap', async () => {
    // Act
    const result = await service.login({ email: 'test@example.com', password: 'example' });
    // Assert
    expect(result).toEqual(expect.any(UserLoginResponseDto));
  });
});
