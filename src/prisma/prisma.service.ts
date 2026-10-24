import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { availableParallelism } from 'os';
import { PoolConfig } from 'pg';

/**
 * Pool settings for the `pg` driver Prisma 7 talks to the database through.
 * Prisma 6 read its pool settings from the connection URL and had its own
 * defaults; `pg` ignores those parameters and defaults to a 10-connection pool
 * that waits forever for a connection. Carry the URL parameters over and keep
 * Prisma 6's defaults, so a deployment tuned through DATABASE_URL behaves the
 * same after the upgrade.
 */
export function getPgOptions(databaseUrl: string | undefined): { pool: PoolConfig; schema?: string } {
  let params = new URLSearchParams();
  try {
    params = new URL(databaseUrl).searchParams;
  } catch {
    // an unparsable URL is left for pg to report when it connects
  }
  const seconds = (name: string, fallback: number) => {
    const value = Number(params.get(name));
    return (Number.isFinite(value) && params.has(name) ? value : fallback) * 1000;
  };
  const connectionLimit = Number(params.get('connection_limit'));
  return {
    pool: {
      connectionString: databaseUrl,
      max: connectionLimit > 0 ? connectionLimit : availableParallelism() * 2 + 1,
      // Prisma 6 waited 5s to open a connection and 10s for a free one; pg has
      // a single timeout for both
      connectionTimeoutMillis: Math.max(seconds('connect_timeout', 5), seconds('pool_timeout', 10)) || undefined,
    },
    schema: params.get('schema') ?? undefined,
  };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const { pool, schema } = getPgOptions(process.env.DATABASE_URL);
    super({
      adapter: new PrismaPg(pool, schema ? { schema } : undefined),
      // log: [{ emit: 'stdout', level: 'query' }],
    });
  }
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
