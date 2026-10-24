import { Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'fs';
import { availableParallelism } from 'os';
import { PoolConfig } from 'pg';

// Connection URL parameters Prisma 6 understood that neither the pg driver nor
// getPgOptions carries over. Some mean something else to pg (sslcert is the
// server's certificate to Prisma, a client certificate to pg).
const UNSUPPORTED_PRISMA_PARAMS = [
  'pgbouncer',
  'statement_cache_size',
  'socket_timeout',
  'sslcert',
  'sslidentity',
  'sslpassword',
];

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
} {
  let url: URL | undefined;
  try {
    url = new URL(databaseUrl);
  } catch {
    // an unparsable URL is left for pg to report when it connects
  }
  const params = url?.searchParams ?? new URLSearchParams();

  // Prisma 6 encrypted under sslmode=prefer/require without checking the
  // certificate unless sslaccept=strict was set; that is libpq's meaning of
  // those modes, while pg alone treats them as verify-full
  const sslmode = params.get('sslmode');
  let connectionString = databaseUrl;
  if (
    (sslmode === 'prefer' || sslmode === 'require') &&
    params.get('sslaccept') !== 'strict' &&
    !params.has('uselibpqcompat')
  ) {
    url.searchParams.set('uselibpqcompat', 'true');
    connectionString = url.toString();
  }

  // 0 means "no timeout" to Prisma; seconds otherwise
  const seconds = (name: string, fallback: number) => {
    const value = params.has(name) ? Number(params.get(name)) : NaN;
    return (Number.isFinite(value) && value >= 0 ? value : fallback) * 1000;
  };
  const connectTimeout = seconds('connect_timeout', 5);
  const poolTimeout = seconds('pool_timeout', 10);
  const connectionLimit = Number(params.get('connection_limit'));

  return {
    pool: {
      connectionString,
      max: connectionLimit > 0 ? connectionLimit : physicalCpuCount() * 2 + 1,
      // Prisma 6 waited up to 5s to open a connection and 10s for a free one;
      // pg has a single timeout for both, so take the longer, and none at all
      // when either was switched off
      connectionTimeoutMillis: connectTimeout && poolTimeout ? Math.max(connectTimeout, poolTimeout) : undefined,
      // Prisma 6 kept idle connections for 300s; pg drops them after 10s,
      // which reconnects over and over between ingestion bursts
      idleTimeoutMillis: 300_000,
    },
    schema: params.get('schema') ?? undefined,
    unsupportedParams: UNSUPPORTED_PRISMA_PARAMS.filter((name) => params.has(name)),
  };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  constructor() {
    const { pool, schema, unsupportedParams } = getPgOptions(process.env.DATABASE_URL);
    super({
      adapter: new PrismaPg(pool, schema ? { schema } : undefined),
      // log: [{ emit: 'stdout', level: 'query' }],
    });
    if (unsupportedParams.length) {
      new Logger(PrismaService.name).warn(
        `DATABASE_URL parameters ignored since Prisma 7: ${unsupportedParams.join(', ')}. ` +
          'Configure them on the pg driver instead (see the pg connection string docs).'
      );
    }
  }
  async onModuleInit() {
    await this.$connect();
  }

  // After the HTTP server has stopped and drained its requests (Nest runs
  // onModuleDestroy before that), so none of them finds the pool closed
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
