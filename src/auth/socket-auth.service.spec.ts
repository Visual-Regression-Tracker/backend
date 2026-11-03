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
  const socket = {
    id: 'socket-id',
    handshake: { auth: undefined as Record<string, unknown> | undefined },
    join: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
    conn: { readyState: 'open', once: jest.fn() },
  };
  const connect = (auth: Record<string, unknown> | undefined) => {
    socket.handshake.auth = auth;
    return new Promise<Error | undefined>((resolve) => middleware(socket as unknown as Socket, resolve));
  };
  const closeFromClient = () => socket.on.mock.calls.find(([event]) => event === 'disconnect')?.[1]();
  const closeConnection = () => socket.conn.once.mock.calls.find(([event]) => event === 'close')?.[1]();
  return { connect, validate, socket, closeFromClient, closeConnection };
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

  describe('an accepted socket', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'], now: new Date('2026-11-03T10:00:00Z') });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("joins the room of the token's user", async () => {
      const { connect, socket } = setup();

      await connect({ token: validToken });

      expect(socket.join).toHaveBeenCalledWith(`user:${user.id}`);
    });

    it('is closed by the server when its token expires', async () => {
      const { connect, socket } = setup();

      await connect({ token: jwtService.sign({ sub: user.id }, { expiresIn: 60 }) });
      jest.advanceTimersByTime(59_999);
      expect(socket.disconnect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('is closed when a token valid for longer than a timer can wait expires', async () => {
      const { connect, socket } = setup();
      const days = 40;

      await connect({ token: jwtService.sign({ sub: user.id }, { expiresIn: `${days}d` }) });
      jest.advanceTimersByTime(days * 24 * 3600 * 1000 - 1);
      expect(socket.disconnect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('leaves no timer behind once it disconnects', async () => {
      const { connect, closeFromClient } = setup();

      await connect({ token: jwtService.sign({ sub: user.id }, { expiresIn: 60 }) });
      closeFromClient();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('leaves no timer behind when its connection closes before it connects', async () => {
      const { connect, closeConnection } = setup();

      await connect({ token: jwtService.sign({ sub: user.id }, { expiresIn: 60 }) });
      closeConnection();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('starts no timer when its connection closed during the token check', async () => {
      const { connect, socket } = setup();
      socket.conn.readyState = 'closed';

      await connect({ token: jwtService.sign({ sub: user.id }, { expiresIn: 60 }) });

      expect(jest.getTimerCount()).toBe(0);
    });

    it('stays open with a token that never expires', async () => {
      const { connect } = setup();

      await connect({ token: validToken });

      expect(jest.getTimerCount()).toBe(0);
    });

    it('joins no room and is never closed without a token when WS_AUTH_REQUIRED is false', async () => {
      const { connect, socket } = setup('false');

      await connect(undefined);

      expect(socket.join).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('with WS_AUTH_REQUIRED false', () => {
    it.each([
      ['no auth', undefined],
      ['no token', {}],
      ['a null token', { token: null }],
      ['an empty token', { token: '' }],
    ])('lets in a socket with %s and warns', async (_case, auth) => {
      const { connect } = setup('false');

      await expect(connect(auth)).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('without a token'));
    });
  });

  describe.each([undefined, 'true'])('with WS_AUTH_REQUIRED %p', (flag) => {
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
