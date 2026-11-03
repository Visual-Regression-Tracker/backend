import { INestApplication, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions } from 'socket.io';

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 5_000;

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

  async connectToRedis(url: string, connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): Promise<void> {
    const startedAt = Date.now();
    let connected = false;
    const reconnectStrategy = (retries: number, cause: Error): number | Error =>
      !connected && Date.now() - startedAt >= connectTimeoutMs
        ? new Error(`Redis at ${describeUrl(url)} is not reachable after ${connectTimeoutMs} ms: ${cause.message}`)
        : Math.min(retries * 200, MAX_RECONNECT_DELAY_MS);

    const pubClient = createClient({
      url,
      // Redis servers before 6.0 do not speak RESP3
      RESP: 2,
      socket: { reconnectStrategy },
    });
    const subClient = pubClient.duplicate();
    // @socket.io/redis-adapter publishes without catch: a timed-out or failed publish would crash the process
    const publish = pubClient.publish.bind(pubClient);
    Object.assign(pubClient, {
      publish: (...args: Parameters<typeof publish>) =>
        publish(...args).catch((error: unknown) => {
          const reason = error instanceof Error ? `${error.constructor.name} ${error.message}`.trim() : String(error);
          RedisIoAdapter.logger.warn(`Redis publish failed, event not sent to other instances: ${reason}`);
          return 0;
        }),
    });

    pubClient.on('error', (err) => RedisIoAdapter.logger.error(`Redis pub client error: ${err}`));
    subClient.on('error', (err) => RedisIoAdapter.logger.error(`Redis sub client error: ${err}`));

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
    } catch (error) {
      pubClient.destroy();
      subClient.destroy();
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
