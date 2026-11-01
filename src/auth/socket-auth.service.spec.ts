import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { Socket } from 'socket.io';
import { JwtStrategy } from './jwt.strategy';
import { SOCKET_UNAUTHORIZED, SocketAuthService } from './socket-auth.service';

const SECRET = 'socket-auth-spec-secret';
const jwtService = new JwtService({ secret: SECRET });
const user = { id: 'user-id', email: 'user@example.com' } as User;
const validToken = jwtService.sign({ sub: user.id, email: user.email });

const setup = (wsAuthRequired?: string) => {
  const validate = jest.fn().mockResolvedValue(user);
  const service = new SocketAuthService(
    jwtService,
    { validate } as unknown as JwtStrategy,
    { get: (key: string) => (key === 'WS_AUTH_REQUIRED' ? wsAuthRequired : undefined) } as ConfigService
  );
  const middleware = service.middleware();
  const connect = (auth: Record<string, unknown> | undefined) =>
    new Promise<Error | undefined>((resolve) =>
      middleware({ id: 'socket-id', handshake: { auth } } as unknown as Socket, resolve)
    );
  return { connect, validate };
};

describe('SocketAuthService', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each([
    ['unset', undefined],
    ['true', 'true'],
  ])('with WS_AUTH_REQUIRED %s', (_title, flag) => {
    it('lets in a socket with a valid token of an existing user', async () => {
      const { connect, validate } = setup(flag);

      await expect(connect({ token: validToken })).resolves.toBeUndefined();

      expect(validate).toHaveBeenCalledWith(expect.objectContaining({ sub: user.id, email: user.email }));
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      ['a token signed with another secret', new JwtService({ secret: 'other' }).sign({ sub: user.id })],
      ['an expired token', jwtService.sign({ sub: user.id }, { expiresIn: -10 })],
      ['a token that is not a JWT', 'abc'],
      ['a token that is not a string', 42],
    ])('refuses %s as unauthorized', async (_case, token) => {
      const { connect } = setup(flag);

      const refusal = await connect({ token });

      expect(refusal?.message).toBe(SOCKET_UNAUTHORIZED);
    });

    it('refuses the token of a user that no longer exists as unauthorized', async () => {
      const { connect, validate } = setup(flag);
      validate.mockRejectedValue(new UnauthorizedException());

      expect((await connect({ token: validToken }))?.message).toBe(SOCKET_UNAUTHORIZED);
    });

    it('refuses with another reason when the user cannot be read, so the client does not log out', async () => {
      const { connect, validate } = setup(flag);
      validate.mockRejectedValue(new Error('database is down'));

      expect((await connect({ token: validToken }))?.message).toBe('Cannot check the token');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('database is down'));
    });
  });

  describe.each([undefined, 'false'])('with WS_AUTH_REQUIRED %p', (flag) => {
    it.each([
      ['no auth', undefined],
      ['no token', {}],
      ['a null token', { token: null }],
      ['an empty token', { token: '' }],
    ])('lets in a socket with %s and warns', async (_case, auth) => {
      const { connect } = setup(flag);

      await expect(connect(auth)).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('without a token'));
    });
  });

  describe.each(['true'])('with WS_AUTH_REQUIRED %p', (flag) => {
    it.each([
      ['no auth', undefined],
      ['no token', {}],
      ['an empty token', { token: '' }],
    ])('refuses a socket with %s as unauthorized', async (_case, auth) => {
      const { connect } = setup(flag);

      expect((await connect(auth))?.message).toBe(SOCKET_UNAUTHORIZED);
    });
  });
});
