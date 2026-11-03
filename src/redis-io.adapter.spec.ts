import { IoAdapter } from '@nestjs/platform-socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisIoAdapter } from './redis-io.adapter';

jest.mock('redis', () => ({ createClient: jest.fn() }));
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn() }));

describe('RedisIoAdapter', () => {
  const createClientMock = createClient as jest.Mock;
  const createAdapterMock = createAdapter as jest.Mock;

  let pubClient: { on: jest.Mock; connect: jest.Mock; destroy: jest.Mock; duplicate: jest.Mock; publish: jest.Mock };
  let subClient: { on: jest.Mock; connect: jest.Mock; destroy: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    subClient = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
    };
    pubClient = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
      publish: jest.fn().mockResolvedValue(1),
      duplicate: jest.fn(() => subClient),
    };
    createClientMock.mockReturnValue(pubClient);
    createAdapterMock.mockReturnValue('ADAPTER_CONSTRUCTOR');
  });

  const makeAdapter = () => new RedisIoAdapter(undefined);

  it('connects a pub/sub client pair and builds the adapter', async () => {
    const adapter = makeAdapter();

    await adapter.connectToRedis('redis://localhost:6379');

    expect(createClientMock).toHaveBeenCalledWith({
      url: 'redis://localhost:6379',
      RESP: 2,
      socket: { reconnectStrategy: expect.any(Function) },
    });
    expect(pubClient.duplicate).toHaveBeenCalledTimes(1);
    expect(pubClient.connect).toHaveBeenCalledTimes(1);
    expect(subClient.connect).toHaveBeenCalledTimes(1);
    expect(createAdapterMock).toHaveBeenCalledWith(pubClient, subClient);
  });

  it('registers error handlers that log instead of crashing', async () => {
    const adapter = makeAdapter();
    await adapter.connectToRedis('redis://localhost:6379');

    expect(pubClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(subClient.on).toHaveBeenCalledWith('error', expect.any(Function));

    const logSpy = jest
      .spyOn((RedisIoAdapter as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    const [, errorHandler] = pubClient.on.mock.calls.find(([event]) => event === 'error');

    expect(() => errorHandler(new Error('boom'))).not.toThrow();
    expect(logSpy).toHaveBeenCalled();

    const [, subErrorHandler] = subClient.on.mock.calls.find(([event]) => event === 'error');
    expect(() => subErrorHandler(new Error('boom'))).not.toThrow();
  });

  describe('publish', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest
        .spyOn((RedisIoAdapter as unknown as { logger: { warn: () => void } }).logger, 'warn')
        .mockImplementation(() => undefined);
    });

    afterEach(() => warnSpy.mockRestore());

    it('passes publishes through to the client', async () => {
      const publish = pubClient.publish;
      await makeAdapter().connectToRedis('redis://localhost:6379');

      await expect(pubClient.publish('channel', 'message')).resolves.toBe(1);
      expect(publish).toHaveBeenCalledWith('channel', 'message');
    });

    it('logs a rejected publish instead of leaving it unhandled', async () => {
      const publish = pubClient.publish;
      await makeAdapter().connectToRedis('redis://localhost:6379');
      class TimeoutError extends Error {}
      publish.mockRejectedValueOnce(new TimeoutError());

      await expect(pubClient.publish('channel', 'message')).resolves.toBe(0);
      expect(warnSpy).toHaveBeenCalledWith('Redis publish failed, event not sent to other instances: TimeoutError');
    });

    it('logs a publish rejected with a non-error value', async () => {
      const publish = pubClient.publish;
      await makeAdapter().connectToRedis('redis://localhost:6379');
      publish.mockRejectedValueOnce('closed');

      await expect(pubClient.publish('channel', 'message')).resolves.toBe(0);
      expect(warnSpy).toHaveBeenCalledWith('Redis publish failed, event not sent to other instances: closed');
    });
  });

  describe('first connection deadline', () => {
    const originalEnv = { ...process.env };
    const strategyOf = () =>
      createClientMock.mock.calls[0][0].socket.reconnectStrategy as (retries: number, cause: Error) => number | Error;
    let now: jest.SpyInstance;
    const connectPending = (url: string, timeoutMs?: number) => {
      let release!: () => void;
      pubClient.connect.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
      const pending = makeAdapter().connectToRedis(url, timeoutMs);
      return { strategy: strategyOf(), finish: async () => (release(), pending) };
    };

    beforeEach(() => {
      now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    });

    afterEach(() => {
      now.mockRestore();
      process.env = { ...originalEnv };
    });

    it('gives up reconnecting once the connect timeout passes before the first connection', async () => {
      const { strategy, finish } = connectPending('redis://:secret@redis-host:6379', 30_000);

      now.mockReturnValue(1_000_000 + 29_999);
      expect(strategy(3, new Error('ECONNREFUSED'))).toBeLessThanOrEqual(5000);
      now.mockReturnValue(1_000_000 + 30_000);
      const result = strategy(4, new Error('ECONNREFUSED'));

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain('redis-host:6379');
      expect((result as Error).message).toContain('ECONNREFUSED');
      expect((result as Error).message).not.toContain('secret');
      await finish();
    });

    it('keeps reconnecting after it has connected once', async () => {
      await makeAdapter().connectToRedis('redis://localhost:6379', 30_000);
      const strategy = strategyOf();

      now.mockReturnValue(1_000_000 + 10 * 60_000);

      expect(strategy(100, new Error('ECONNRESET'))).toBe(5000);
    });

    it('backs off by 200 ms per retry up to 5 s', async () => {
      await makeAdapter().connectToRedis('redis://localhost:6379', 30_000);
      const strategy = strategyOf();

      expect(strategy(1, new Error('x'))).toBe(200);
      expect(strategy(10, new Error('x'))).toBe(2000);
      expect(strategy(1000, new Error('x'))).toBe(5000);
    });

    it('destroys both clients when the first connection fails', async () => {
      pubClient.connect.mockRejectedValueOnce(new Error('redis down'));

      await expect(makeAdapter().connectToRedis('redis://localhost:6379')).rejects.toThrow('redis down');

      expect(pubClient.destroy).toHaveBeenCalledTimes(1);
      expect(subClient.destroy).toHaveBeenCalledTimes(1);
      expect(createAdapterMock).not.toHaveBeenCalled();
    });

    it('gives up after 30 seconds by default', async () => {
      const { strategy, finish } = connectPending('redis://localhost:6379');

      now.mockReturnValue(1_000_000 + 30_000 - 1);
      expect(typeof strategy(1, new Error('x'))).toBe('number');
      now.mockReturnValue(1_000_000 + 30_000);
      expect(strategy(2, new Error('x'))).toBeInstanceOf(Error);
      await finish();
    });

    it('does not put a malformed url into the error', async () => {
      const { strategy, finish } = connectPending('not a url with secret', 1000);

      now.mockReturnValue(1_000_000 + 1000);
      const result = strategy(1, new Error('x')) as Error;

      expect(result.message).toContain('REDIS_URL');
      expect(result.message).not.toContain('secret');
      await finish();
    });
  });

  it('attaches the redis adapter to the created server', async () => {
    const server = { adapter: jest.fn() };
    const superSpy = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(server as never);

    const adapter = makeAdapter();
    await adapter.connectToRedis('redis://localhost:6379');
    const result = adapter.createIOServer(3000, { path: '/socket.io' } as never);

    expect(superSpy).toHaveBeenCalledWith(3000, { path: '/socket.io' });
    expect(server.adapter).toHaveBeenCalledWith('ADAPTER_CONSTRUCTOR');
    expect(result).toBe(server);

    superSpy.mockRestore();
  });

  describe('use', () => {
    beforeEach(() => {
      jest
        .spyOn((RedisIoAdapter as unknown as { logger: { log: () => void } }).logger, 'log')
        .mockImplementation(() => undefined);
    });

    it('skips wiring and returns false without a url', async () => {
      const app = { useWebSocketAdapter: jest.fn() };

      const enabled = await RedisIoAdapter.use(app as never, undefined);

      expect(enabled).toBe(false);
      expect(app.useWebSocketAdapter).not.toHaveBeenCalled();
    });

    it('connects and installs the adapter when a url is provided', async () => {
      const app = { useWebSocketAdapter: jest.fn() };

      const enabled = await RedisIoAdapter.use(app as never, 'redis://localhost:6379');

      expect(enabled).toBe(true);
      expect(createClientMock).toHaveBeenCalledWith(expect.objectContaining({ url: 'redis://localhost:6379' }));
      expect(app.useWebSocketAdapter).toHaveBeenCalledWith(expect.any(RedisIoAdapter));
    });
  });
});
