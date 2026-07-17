import { IoAdapter } from '@nestjs/platform-socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisIoAdapter } from './redis-io.adapter';

jest.mock('redis', () => ({ createClient: jest.fn() }));
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn() }));

describe('RedisIoAdapter', () => {
  const createClientMock = createClient as jest.Mock;
  const createAdapterMock = createAdapter as jest.Mock;

  let pubClient: { on: jest.Mock; connect: jest.Mock; duplicate: jest.Mock };
  let subClient: { on: jest.Mock; connect: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    subClient = { on: jest.fn(), connect: jest.fn().mockResolvedValue(undefined) };
    pubClient = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      duplicate: jest.fn(() => subClient),
    };
    createClientMock.mockReturnValue(pubClient);
    createAdapterMock.mockReturnValue('ADAPTER_CONSTRUCTOR');
  });

  const makeAdapter = () => new RedisIoAdapter(undefined as never);

  it('connects a pub/sub client pair and builds the adapter', async () => {
    const adapter = makeAdapter();

    await adapter.connectToRedis('redis://localhost:6379');

    expect(createClientMock).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
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

  it('rejects when a client fails to connect', async () => {
    pubClient.connect.mockRejectedValueOnce(new Error('redis down'));
    const adapter = makeAdapter();

    await expect(adapter.connectToRedis('redis://localhost:6379')).rejects.toThrow('redis down');
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
      expect(createClientMock).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
      expect(app.useWebSocketAdapter).toHaveBeenCalledWith(expect.any(RedisIoAdapter));
    });
  });
});
