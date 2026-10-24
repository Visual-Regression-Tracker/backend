import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { compare } from 'bcryptjs';
import uuidAPIKey from 'uuid-apikey';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: { sign: jest.Mock };

  beforeEach(async () => {
    jwtService = { sign: jest.fn().mockReturnValue('signed-token') };
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService, { provide: UsersService, useValue: {} }, { provide: JwtService, useValue: jwtService }],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('encryptPassword', () => {
    it('produces a salted bcrypt hash with 10 rounds that matches the password', async () => {
      const hashed = await service.encryptPassword('secret');

      expect(hashed).toMatch(/^\$2[ab]\$10\$.{53}$/);
      await expect(compare('secret', hashed)).resolves.toBe(true);
    });

    it('produces a different hash for the same password every time', async () => {
      const [first, second] = await Promise.all([service.encryptPassword('secret'), service.encryptPassword('secret')]);

      expect(first).not.toBe(second);
    });
  });

  describe('compare', () => {
    it('accepts the password a hash was made from', async () => {
      const hashed = await service.encryptPassword('secret');

      await expect(service.compare('secret', hashed)).resolves.toBe(true);
    });

    it('rejects a different password', async () => {
      const hashed = await service.encryptPassword('secret');

      await expect(service.compare('wrong', hashed)).resolves.toBe(false);
    });
  });

  describe('generateApiKey', () => {
    it('returns a valid uuid-apikey without dashes', () => {
      const apiKey = service.generateApiKey();

      expect(apiKey).toMatch(/^[0-9A-Z]{28}$/);
      expect(uuidAPIKey.isAPIKey(apiKey)).toBe(true);
    });

    it('returns a new key on every call', () => {
      expect(service.generateApiKey()).not.toBe(service.generateApiKey());
    });
  });

  describe('signToken', () => {
    it('signs a payload carrying only the email of the user', () => {
      const user = { id: 'user-id', email: 'user@example.com', password: 'hash', apiKey: 'key' } as User;

      expect(service.signToken(user)).toBe('signed-token');
      expect(jwtService.sign).toHaveBeenCalledWith({ email: 'user@example.com' });
    });
  });
});
