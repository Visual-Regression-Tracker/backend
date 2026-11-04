import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getSeedPgOptions } from './pg-options';

const { config, schema } = getSeedPgOptions(process.env.DATABASE_URL);

const prisma = new PrismaClient({
  adapter: new PrismaPg(config, schema ? { schema } : undefined),
  // 'query' would print every statement, including the ones that carry password hashes and API keys
  log: ['warn', 'error'],
});

export default prisma;
