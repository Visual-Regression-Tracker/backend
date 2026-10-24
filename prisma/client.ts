import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  // 'info' | 'query' | 'warn' | 'error'
  log: ['query'],
});
export default prisma;
