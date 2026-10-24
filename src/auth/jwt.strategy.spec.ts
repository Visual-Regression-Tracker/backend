import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

const SECRET = 'jwt-strategy-spec-secret';
const sign = (payload: object, secret: string) => new JwtService({ secret }).sign(payload);
const user = { id: 'user-id', email: 'user@example.com' } as User;

describe('JwtStrategy', () => {
  let prismaService: { user: { findUnique: jest.Mock } };
  let configService: { get: jest.Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    prismaService = { user: { findUnique: jest.fn() } };
    configService = { get: jest.fn().mockReturnValue(SECRET) };
    strategy = new JwtStrategy(configService as unknown as ConfigService, prismaService as unknown as PrismaService);
  });

  describe('constructor', () => {
    it('reads the signing secret from JWT_SECRET', () => {
      expect(configService.get).toHaveBeenCalledWith('JWT_SECRET');
    });

    it('registers itself as the "jwt" passport strategy', () => {
      expect(strategy.name).toBe('jwt');
    });

    it('takes the token from the Authorization bearer header', () => {
      const jwtFromRequest = (strategy as unknown as { _jwtFromRequest: (req: unknown) => string | null })
        ._jwtFromRequest;

      expect(jwtFromRequest({ headers: { authorization: 'Bearer abc.def.ghi' } })).toBe('abc.def.ghi');
      expect(jwtFromRequest({ headers: {} })).toBeNull();
    });

    it('fails to construct without a secret', () => {
      configService.get.mockReturnValue(undefined);

      expect(
        () => new JwtStrategy(configService as unknown as ConfigService, prismaService as unknown as PrismaService)
      ).toThrow('JwtStrategy requires a secret or key');
    });
  });

  describe('validate', () => {
    it('looks the user up by the email in the payload and passes it to done', async () => {
      prismaService.user.findUnique.mockResolvedValue(user);
      const done = jest.fn().mockReturnValue('done-result');

      const result = await strategy.validate({ email: user.email }, done);

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({ where: { email: user.email } });
      expect(done).toHaveBeenCalledWith(null, user, undefined);
      expect(result).toBe('done-result');
    });

    it('passes payload.expire as the info argument', async () => {
      prismaService.user.findUnique.mockResolvedValue(user);
      const done = jest.fn();

      await strategy.validate({ email: user.email, expire: 123 } as never, done);

      expect(done).toHaveBeenCalledWith(null, user, 123);
    });

    it('passes a 401 HttpException and false to done when the user does not exist', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);
      const done = jest.fn();

      await strategy.validate({ email: 'ghost@example.com' }, done);

      expect(done).toHaveBeenCalledTimes(1);
      const [error, result] = done.mock.calls[0];
      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect(error.getResponse()).toEqual({});
      expect(result).toBe(false);
    });
  });

  // Drives the strategy the way passport does, with a real signed token.
  describe('authenticate', () => {
    const authenticate = (token?: string) => {
      const outcome = { success: jest.fn(), fail: jest.fn(), error: jest.fn() };
      Object.assign(strategy, outcome);
      strategy.authenticate({ headers: token ? { authorization: `Bearer ${token}` } : {} } as never);
      return outcome;
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    // NOTE: current behavior — validate() calls `done` itself and the
    // @nestjs/passport mixin calls it a second time with validate()'s return
    // value (undefined), so passport sees success() followed by fail().
    it('authenticates a valid token, then also reports a failure from the second done call', async () => {
      prismaService.user.findUnique.mockResolvedValue(user);

      const outcome = authenticate(sign({ email: user.email }, SECRET));
      await settle();

      expect(outcome.success).toHaveBeenCalledWith(user, undefined);
      expect(outcome.fail).toHaveBeenCalledTimes(1);
      expect(outcome.success.mock.invocationCallOrder[0]).toBeLessThan(outcome.fail.mock.invocationCallOrder[0]);
      expect(outcome.error).not.toHaveBeenCalled();
    });

    it('errors with a 401 HttpException when the token belongs to an unknown user', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      const outcome = authenticate(sign({ email: 'ghost@example.com' }, SECRET));
      await settle();

      expect(outcome.error).toHaveBeenCalledWith(expect.any(HttpException));
      expect(outcome.success).not.toHaveBeenCalled();
    });

    it('fails a token signed with another secret without touching the database', async () => {
      const outcome = authenticate(sign({ email: user.email }, 'other-secret'));
      await settle();

      expect(outcome.fail).toHaveBeenCalled();
      expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    });

    it('fails an expired token', async () => {
      const outcome = authenticate(sign({ email: user.email, exp: Math.floor(Date.now() / 1000) - 60 }, SECRET));
      await settle();

      expect(outcome.fail).toHaveBeenCalledWith(expect.objectContaining({ name: 'TokenExpiredError' }));
      expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    });

    it('fails a request without a token', async () => {
      const outcome = authenticate();
      await settle();

      expect(outcome.fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'No auth token' }));
    });
  });
});
