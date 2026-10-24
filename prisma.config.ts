import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 6 read both env files on its own; DATABASE_URL lives in prisma/.env.
// dotenv never overrides a variable that is already set, so .env wins.
config({ quiet: true });
config({ path: 'prisma/.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    // generating the client needs no database, so a missing URL is only an
    // error for the commands that actually connect
    url: process.env.DATABASE_URL ?? '',
  },
});
