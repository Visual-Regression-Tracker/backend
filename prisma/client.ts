import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getSeedPgOptions } from './pg-options';

const { connectionString, schema } = getSeedPgOptions(process.env.DATABASE_URL);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }, schema ? { schema } : undefined),
  // 'info' | 'query' | 'warn' | 'error'
  log: ['query'],
});
export default prisma;
