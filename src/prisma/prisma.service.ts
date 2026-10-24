import { Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'fs';
import { availableParallelism } from 'os';
import { isAbsolute, resolve } from 'path';
import { Client, ClientConfig, PoolConfig } from 'pg';

// Connection URL parameters Prisma 6 understood that neither the pg driver nor
// getPgOptions carries over.
const UNSUPPORTED_PRISMA_PARAMS = ['pgbouncer', 'statement_cache_size', 'socket_timeout', 'sslidentity', 'sslpassword'];

// TLS parameters with Prisma 6's meaning: getPgOptions turns them into pg's
// `ssl` option and takes them out of the URL, where pg would read them its
// own way (sslcert as a client certificate, require as verify-full).
const PRISMA_SSL_PARAMS = ['sslmode', 'sslaccept', 'sslcert'];
// Parameters only pg knows. A URL carrying one was written for pg, so its
// TLS settings are left to pg as they are.
const PG_ONLY_SSL_PARAMS = ['sslrootcert', 'sslkey', 'uselibpqcompat'];

const SSL_NOT_SUPPORTED = 'The server does not support SSL connections';

const readCpuinfo = (): string => {
  try {
    return readFileSync('/proc/cpuinfo', 'utf8');
  } catch {
    return '';
  }
};

/**
 * Physical cores, counted the way Prisma 6 sized its default pool
 * (`num_physical_cpus * 2 + 1`, Rust's num_cpus::get_physical): distinct
 * (physical id, core id) pairs in /proc/cpuinfo. Hyper-threads would double a
 * logical count, and with it every replica's share of max_connections. Where
 * cpuinfo has no such fields (ARM, macOS) it falls back to the logical count,
 * as num_cpus does.
 */
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

/**
 * Pool settings for the `pg` driver Prisma 7 talks to the database through.
 * Prisma 6 read its pool and TLS settings from the connection URL and had its
 * own defaults; `pg` ignores those parameters, defaults to a 10-connection pool
 * that waits forever for a connection, and verifies the certificate under
 * `sslmode=require`. Carry the URL parameters over and keep Prisma 6's
 * behaviour, so a deployment tuned through DATABASE_URL works the same after
 * the upgrade.
 */
export function getPgOptions(databaseUrl: string | undefined): {
  pool: PoolConfig;
  schema?: string;
  unsupportedParams: string[];
  preferSsl: boolean;
} {
  let url: URL | undefined;
  try {
    url = new URL(databaseUrl);
  } catch {
    // an unparsable URL is left for pg to report when it connects
  }
  const params = url?.searchParams ?? new URLSearchParams();

  // 0 means "no timeout" to Prisma; seconds otherwise
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
    // Prisma 6 waited up to 5s to open a connection and 10s for a free one;
    // pg has a single timeout for both, so take the longer, and none at all
    // when either was switched off
    connectionTimeoutMillis: connectTimeout && poolTimeout ? Math.max(connectTimeout, poolTimeout) : undefined,
    // Prisma 6 kept idle connections for 300s; pg drops them after 10s,
    // which reconnects over and over between ingestion bursts
    idleTimeoutMillis: 300_000,
  };

  const sslmode = params.get('sslmode') ?? 'prefer';
  const prismaTls =
    url !== undefined &&
    ['prefer', 'require', 'disable'].includes(sslmode) &&
    !PG_ONLY_SSL_PARAMS.some((name) => params.has(name));
  if (prismaTls) {
    // Prisma 6: prefer (its default) tries TLS and falls back to plaintext,
    // require insists on TLS, and neither checks the certificate unless
    // sslaccept=strict, which checks it against sslcert (resolved, like
    // Prisma did, from the prisma/ folder) or the system CAs
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

/**
 * sslmode=prefer, which pg cannot do per connection: one trial connection
 * over TLS, and plaintext from then on if the server has no TLS at all.
 * Anything else that goes wrong is left for the real connection to report.
 */
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
    await client.end().catch(() => undefined);
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  // the very object the adapter builds its pool from when Prisma first connects
  private readonly pgConfig: PoolConfig;
  private readonly preferSsl: boolean;

  constructor() {
    const { pool, schema, unsupportedParams, preferSsl } = getPgOptions(process.env.DATABASE_URL);
    super({
      adapter: new PrismaPg(pool, schema ? { schema } : undefined),
      // log: [{ emit: 'stdout', level: 'query' }],
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

  /**
   * A connection of its own, with the same settings as the pool but outside
   * it, for state bound to one connection that must not tie up a pooled one
   * for long — such as the advisory lock the nightly cleanup holds while it runs.
   * Not connected yet; the caller connects and ends it.
   */
  dedicatedClient(): Client {
    return new Client(this.pgConfig);
  }

  // After the HTTP server has stopped and drained its requests (Nest runs
  // onModuleDestroy before that), so none of them finds the pool closed
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
