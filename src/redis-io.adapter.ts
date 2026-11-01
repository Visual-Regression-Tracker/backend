import { INestApplication, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions } from 'socket.io';
import { positiveNumber } from './utils/env';

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 5_000;

const connectTimeoutFromEnv = (): number =>
  positiveNumber(process.env.REDIS_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS);

const describeUrl = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return 'REDIS_URL';
  }
};

export class RedisIoAdapter extends IoAdapter {
  private static readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor!: ReturnType<typeof createAdapter>;

  async connectToRedis(url: string, connectTimeoutMs = connectTimeoutFromEnv()): Promise<void> {
    const startedAt = Date.now();
    let connected = false;
    const reconnectStrategy = (retries: number, cause: Error): number | Error =>
      !connected && Date.now() - startedAt >= connectTimeoutMs
        ? new Error(`Redis at ${describeUrl(url)} is not reachable after ${connectTimeoutMs} ms: ${cause.message}`)
        : Math.min(retries * 200, MAX_RECONNECT_DELAY_MS);

    // no disableOfflineQueue: @socket.io/redis-adapter publishes without catch, an offline rejection would crash the process
    const pubClient = createClient({ url, socket: { reconnectStrategy } });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => RedisIoAdapter.logger.error(`Redis pub client error: ${err}`));
    subClient.on('error', (err) => RedisIoAdapter.logger.error(`Redis sub client error: ${err}`));

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
    } catch (error) {
      await Promise.allSettled([pubClient.disconnect(), subClient.disconnect()]);
      throw error;
    }
    connected = true;
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }

  static async use(app: INestApplication, redisUrl?: string): Promise<boolean> {
    if (!redisUrl) {
      this.logger.log('REDIS_URL not set — socket.io running with the in-memory adapter (single instance only)');
      return false;
    }

    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis(redisUrl);
    app.useWebSocketAdapter(adapter);
    this.logger.log('Socket.io Redis adapter enabled');
    return true;
  }
}
