import { INestApplication, INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions } from 'socket.io';

/**
 * Socket.io adapter backed by Redis pub/sub so that events emitted from any
 * API instance are delivered to clients connected to every other instance.
 * Without it a multi-replica deployment only broadcasts to clients that happen
 * to be connected to the same instance that emitted the event.
 */
export class RedisIoAdapter extends IoAdapter {
  private static readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(url: string): Promise<void> {
    const pubClient = createClient({ url });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => RedisIoAdapter.logger.error(`Redis pub client error: ${err}`));
    subClient.on('error', (err) => RedisIoAdapter.logger.error(`Redis sub client error: ${err}`));

    await Promise.all([pubClient.connect(), subClient.connect()]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }

  /**
   * Installs the Redis-backed socket.io adapter on the app when `redisUrl` is
   * provided. Returns whether the Redis adapter was enabled (false = default
   * in-memory adapter, i.e. single-instance mode).
   */
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
