import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// dotenv never overrides a variable that is already set, so .env wins over prisma/.env
config({ quiet: true });
config({ path: 'prisma/.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    // generating the client needs no database; only commands that connect need the URL
    url: process.env.DATABASE_URL ?? '',
  },
});
