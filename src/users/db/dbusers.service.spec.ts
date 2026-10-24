import { HttpException, HttpStatus } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { DbUsersService } from './dbusers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../../auth/auth.service';
import { UserLoginResponseDto } from '../dto/user-login-response.dto';

const user: User = {
  id: '1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  apiKey: 'apiKey',
  password: 'encryptedPassword',
  isActive: true,
  role: Role.editor,
  updatedAt: new Date(),
  createdAt: new Date(),
};

describe('DbUsersService', () => {
  let service: DbUsersService;
  let prisma: { user: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock } };
  let auth: { generateApiKey: jest.Mock; encryptPassword: jest.Mock; compare: jest.Mock; signToken: jest.Mock };

  beforeEach(() => {
    prisma = { user: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() } };
    auth = {
      generateApiKey: jest.fn().mockReturnValue('generatedApiKey'),
      encryptPassword: jest.fn().mockResolvedValue('hashed'),
      compare: jest.fn(),
      signToken: jest.fn().mockReturnValue('token'),
    };
    service = new DbUsersService(prisma as unknown as PrismaService, auth as unknown as AuthService);
  });

  describe('create', () => {
    it('stores a trimmed lower-case email, a new api key and the hashed password, without a token', async () => {
      prisma.user.create.mockResolvedValue(user);

      const result = await service.create({
        email: '  Test@Example.COM ',
        firstName: 'John',
        lastName: 'Doe',
        password: 'secret',
      });

      expect(auth.encryptPassword).toHaveBeenCalledWith('secret');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          apiKey: 'generatedApiKey',
          password: 'hashed',
        },
      });
      expect(result).toEqual(new UserLoginResponseDto(user, null));
      expect(result.token).toBeNull();
    });
  });

  describe('update', () => {
    it('updates the profile fields as given and returns a fresh token', async () => {
      prisma.user.update.mockResolvedValue(user);

      const result = await service.update('1', { email: ' Mixed@Case.com', firstName: 'J', lastName: 'D' });

      // NOTE: current behavior — unlike create, the email is stored as given (not trimmed or lower-cased)
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { email: ' Mixed@Case.com', firstName: 'J', lastName: 'D' },
      });
      expect(auth.signToken).toHaveBeenCalledWith(user);
      expect(result).toEqual(new UserLoginResponseDto(user, 'token'));
    });
  });

  describe('changePassword', () => {
    it('stores the hashed new password', async () => {
      prisma.user.update.mockResolvedValue(user);

      await expect(service.changePassword(user, 'new secret')).resolves.toBe(true);

      expect(auth.encryptPassword).toHaveBeenCalledWith('new secret');
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: '1' }, data: { password: 'hashed' } });
    });
  });

  describe('login', () => {
    it('returns the user with a token when the password matches', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      auth.compare.mockResolvedValue(true);

      const result = await service.login({ email: 'test@example.com', password: 'secret' });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
      expect(auth.compare).toHaveBeenCalledWith('secret', 'encryptedPassword');
      expect(result).toEqual(new UserLoginResponseDto(user, 'token'));
    });

    it('rejects an unknown email with the same message as a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ email: 'nobody@example.com', password: 'secret' })).rejects.toThrow(
        new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST)
      );
      expect(auth.compare).not.toHaveBeenCalled();
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      auth.compare.mockResolvedValue(false);

      await expect(service.login({ email: 'test@example.com', password: 'wrong' })).rejects.toThrow(
        new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST)
      );
      expect(auth.signToken).not.toHaveBeenCalled();
    });

    it('looks the email up exactly as typed', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ email: ' Test@Example.com', password: 'secret' })).rejects.toThrow(HttpException);

      // NOTE: current behavior — create() lower-cases and trims, login() does not,
      // so a user registered as "Test@Example.com" must log in as "test@example.com"
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: ' Test@Example.com' } });
    });
  });
});
