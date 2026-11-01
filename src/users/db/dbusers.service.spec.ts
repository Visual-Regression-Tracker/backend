import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
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
    const current = { ...user, email: 'Test@Example.com' };

    it('updates the profile fields and returns a fresh token', async () => {
      prisma.user.findUnique.mockResolvedValue(current);
      prisma.user.update.mockResolvedValue(user);

      const result = await service.update('1', { email: 'test@example.com', firstName: 'J', lastName: 'D' });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: '1' } });
      expect(auth.signToken).toHaveBeenCalledWith(user);
      expect(result).toEqual(new UserLoginResponseDto(user, 'token'));
    });

    it.each([
      ['stores a changed email in lower case', ' New@Example.com ', 'new@example.com'],
      ['keeps the stored spelling when only the case differs', 'test@EXAMPLE.com', 'Test@Example.com'],
    ])('%s', async (_name, sent, stored) => {
      prisma.user.findUnique.mockResolvedValue(current);
      prisma.user.update.mockResolvedValue(user);

      await service.update('1', { email: sent, firstName: 'J', lastName: 'D' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { email: stored, firstName: 'J', lastName: 'D' },
      });
    });

    it('answers 404 when the user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.update('1', { email: 'a@b.com', firstName: 'J', lastName: 'D' })).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
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
    const invalid = new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST);

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

      await expect(service.login({ email: 'nobody@example.com', password: 'secret' })).rejects.toThrow(invalid);
      expect(auth.compare).not.toHaveBeenCalled();
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      auth.compare.mockResolvedValue(false);

      await expect(service.login({ email: 'test@example.com', password: 'wrong' })).rejects.toThrow(invalid);
      expect(auth.signToken).not.toHaveBeenCalled();
    });

    it('signs in with a differently cased email', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(user);
      auth.compare.mockResolvedValue(true);

      const result = await service.login({ email: ' John@Example.com ', password: 'secret' });

      expect(prisma.user.findUnique).toHaveBeenNthCalledWith(1, { where: { email: 'John@Example.com' } });
      expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, { where: { email: 'john@example.com' } });
      expect(result).toEqual(new UserLoginResponseDto(user, 'token'));
    });

    it('keeps signing in a mixed-case row with its exact spelling', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ ...user, email: 'John@Example.com' });
      auth.compare.mockResolvedValue(true);

      await service.login({ email: 'John@Example.com', password: 'secret' });

      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'John@Example.com' } });
    });

    it('looks a lower-case email up once', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ email: 'nobody@example.com', password: 'secret' })).rejects.toThrow(HttpException);

      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});
