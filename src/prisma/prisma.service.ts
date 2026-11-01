import { Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'fs';
import { availableParallelism } from 'os';
import { isAbsolute, resolve } from 'path';
import { Client, ClientConfig, PoolConfig } from 'pg';

const UNSUPPORTED_PRISMA_PARAMS = ['pgbouncer', 'statement_cache_size', 'socket_timeout', 'sslidentity', 'sslpassword'];

// Translated into pg's `ssl`: pg reads sslcert as a client certificate and require as verify-full
const PRISMA_SSL_PARAMS = ['sslmode', 'sslaccept', 'sslcert'];
const PG_ONLY_SSL_PARAMS = ['sslrootcert', 'sslkey', 'uselibpqcompat'];

const SSL_NOT_SUPPORTED = 'The server does not support SSL connections';

const readCpuinfo = (): string => {
  try {
    return readFileSync('/proc/cpuinfo', 'utf8');
  } catch {
    return '';
  }
};

// Prisma 6 sized its pool from physical cores; hyper-threads would double connections
export function physicalCpuCount(cpuinfo: string = readCpuinfo()): number {
  const cores = new Set<string>();
  for (const block of cpuinfo.split(/\n\s*\n/)) {
    const physicalId = block.match(/^physical id\s*:\s*(\d+)/m)?.[1];
    const coreId = block.match(/^core id\s*:\s*(\d+)/m)?.[1];
    if (physicalId !== undefined && coreId !== undefined) {
      cores.add(`${physicalId}:${coreId}`);
    }
  }
  return cores.size || availableParallelism();
}

export function getPgOptions(databaseUrl: string | undefined): {
  pool: PoolConfig;
  schema?: string;
  unsupportedParams: string[];
  preferSsl: boolean;
} {
  let url: URL | undefined;
  try {
    url = new URL(databaseUrl as string);
  } catch {}
  const params = url?.searchParams ?? new URLSearchParams();

  const seconds = (name: string, fallback: number) => {
    const value = params.has(name) ? Number(params.get(name)) : NaN;
    return (Number.isFinite(value) && value >= 0 ? value : fallback) * 1000;
  };
  const connectTimeout = seconds('connect_timeout', 5);
  const poolTimeout = seconds('pool_timeout', 10);
  const connectionLimit = Number(params.get('connection_limit'));

  const pool: PoolConfig = {
    connectionString: databaseUrl,
    max: connectionLimit > 0 ? connectionLimit : physicalCpuCount() * 2 + 1,
    connectionTimeoutMillis: connectTimeout && poolTimeout ? Math.max(connectTimeout, poolTimeout) : undefined,
    // Prisma 6's value; pg's 10s default reconnects over and over between ingestion bursts
    idleTimeoutMillis: 300_000,
  };

  const sslmode = params.get('sslmode') ?? 'prefer';
  const prismaTls =
    url !== undefined &&
    ['prefer', 'require', 'disable'].includes(sslmode) &&
    !PG_ONLY_SSL_PARAMS.some((name) => params.has(name));
  if (url && prismaTls) {
    // Prisma 6: no certificate check unless sslaccept=strict
    const sslcert = params.get('sslcert');
    const ssl =
      params.get('sslaccept') === 'strict'
        ? { ...(sslcert && { ca: readFileSync(isAbsolute(sslcert) ? sslcert : resolve('prisma', sslcert)) }) }
        : { rejectUnauthorized: false };
    PRISMA_SSL_PARAMS.forEach((name) => url.searchParams.delete(name));
    pool.connectionString = url.toString();
    pool.ssl = sslmode === 'disable' ? false : ssl;
  }

  return {
    pool,
    schema: params.get('schema') ?? undefined,
    unsupportedParams: UNSUPPORTED_PRISMA_PARAMS.filter((name) => params.has(name)),
    preferSsl: prismaTls && sslmode === 'prefer',
  };
}

export async function negotiatePreferredSsl(config: ClientConfig, logger?: Logger): Promise<void> {
  const client = new Client(config);
  try {
    await client.connect();
  } catch (error) {
    if (error instanceof Error && error.message === SSL_NOT_SUPPORTED) {
      config.ssl = false;
      logger?.log('Database server has no TLS, connecting without it (sslmode=prefer)');
    }
  } finally {
    await client.end().catch((): undefined => undefined);
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pgConfig: PoolConfig;
  private readonly preferSsl: boolean;

  constructor() {
    const { pool, schema, unsupportedParams, preferSsl } = getPgOptions(process.env.DATABASE_URL);
    super({
      adapter: new PrismaPg(pool, schema ? { schema } : undefined),
    });
    this.pgConfig = pool;
    this.preferSsl = preferSsl;
    if (unsupportedParams.length) {
      this.logger.warn(
        `DATABASE_URL parameters ignored since Prisma 7: ${unsupportedParams.join(', ')}. ` +
          'Configure them on the pg driver instead (see the pg connection string docs).'
      );
    }
  }

  async onModuleInit() {
    if (this.preferSsl) {
      await negotiatePreferredSsl(this.pgConfig, this.logger);
    }
    await this.$connect();
  }

  dedicatedClient(): Client {
    return new Client(this.pgConfig);
  }

  // Not onModuleDestroy: that runs before the HTTP server has drained its requests
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
