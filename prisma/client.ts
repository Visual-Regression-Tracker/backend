import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  // 'info' | 'query' | 'warn' | 'error'
  log: ['query'],
});
export default prisma;
