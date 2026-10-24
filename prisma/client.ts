import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getSeedPgOptions, negotiatePreferredSsl } from './pg-options';

const { config, schema, preferSsl } = getSeedPgOptions(process.env.DATABASE_URL);

const prisma = new PrismaClient({
  // the adapter builds its connection from this object when Prisma first
  // connects, so prepareConnection can still settle TLS on it
  adapter: new PrismaPg(config, schema ? { schema } : undefined),
  // 'info' | 'query' | 'warn' | 'error'
  log: ['query'],
});

/** Settles sslmode=prefer; call before the first query. */
export async function prepareConnection(): Promise<void> {
  if (preferSsl) {
    await negotiatePreferredSsl(config);
  }
}

export default prisma;
