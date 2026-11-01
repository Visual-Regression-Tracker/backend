import { UnauthorizedException } from '@nestjs/common';
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

  const createStrategy = () =>
    new JwtStrategy(configService as unknown as ConfigService, prismaService as unknown as PrismaService);
  const withLegacyTokens = (value: string) => {
    configService.get.mockImplementation((key: string) => (key === 'JWT_LEGACY_EMAIL_TOKENS' ? value : SECRET));
    strategy = createStrategy();
  };

  beforeEach(() => {
    prismaService = { user: { findUnique: jest.fn() } };
    configService = { get: jest.fn().mockReturnValue(SECRET) };
    strategy = createStrategy();
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

      expect(createStrategy).toThrow('JwtStrategy requires a secret or key');
    });
  });

  describe('validate', () => {
    it('returns the user the sub claim points to', async () => {
      prismaService.user.findUnique.mockResolvedValue(user);

      await expect(strategy.validate({ sub: 'user-id', email: 'old@example.com' })).resolves.toBe(user);

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-id' } });
    });

    it('throws UnauthorizedException when the user does not exist', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      await expect(strategy.validate({ sub: 'ghost' })).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a payload with neither sub nor email without a lookup', async () => {
      await expect(strategy.validate({})).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('authenticate', () => {
    const authenticate = (token?: string) => {
      const outcome = { success: jest.fn(), fail: jest.fn(), error: jest.fn() };
      Object.assign(strategy, outcome);
      strategy.authenticate({ headers: token ? { authorization: `Bearer ${token}` } : {} } as never);
      return outcome;
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    it('authenticates a valid token exactly once', async () => {
      prismaService.user.findUnique.mockResolvedValue(user);

      const outcome = authenticate(sign({ sub: 'user-id', email: user.email }, SECRET));
      await settle();

      expect(outcome.success).toHaveBeenCalledTimes(1);
      expect(outcome.success).toHaveBeenCalledWith(user, undefined);
      expect(outcome.fail).not.toHaveBeenCalled();
      expect(outcome.error).not.toHaveBeenCalled();
    });

    it('resolves a token with sub by user id', async () => {
      prismaService.user.findUnique.mockResolvedValue(user);

      authenticate(sign({ sub: 'user-id', email: 'email-before-the-change@example.com' }, SECRET));
      await settle();

      expect(prismaService.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaService.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-id' } });
    });

    it('still accepts an email-only token issued before sub existed', async () => {
      prismaService.user.findUnique.mockResolvedValue(user);

      const outcome = authenticate(sign({ email: user.email }, SECRET));
      await settle();

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({ where: { email: user.email } });
      expect(outcome.success).toHaveBeenCalledWith(user, undefined);
    });

    it.each(['false', ' FALSE '])('rejects an email-only token when JWT_LEGACY_EMAIL_TOKENS=%j', async (value) => {
      withLegacyTokens(value);

      const outcome = authenticate(sign({ email: user.email }, SECRET));
      await settle();

      expect(prismaService.user.findUnique).not.toHaveBeenCalled();
      expect(outcome.error).toHaveBeenCalledWith(expect.any(UnauthorizedException));
      expect(outcome.success).not.toHaveBeenCalled();
    });

    it('keeps accepting tokens with sub when JWT_LEGACY_EMAIL_TOKENS=false', async () => {
      withLegacyTokens('false');
      prismaService.user.findUnique.mockResolvedValue(user);

      const outcome = authenticate(sign({ sub: 'user-id', email: user.email }, SECRET));
      await settle();

      expect(outcome.success).toHaveBeenCalledWith(user, undefined);
    });

    it('errors with a 401 when the token belongs to an unknown user', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      const outcome = authenticate(sign({ sub: 'ghost' }, SECRET));
      await settle();

      expect(outcome.error).toHaveBeenCalledWith(expect.any(UnauthorizedException));
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
