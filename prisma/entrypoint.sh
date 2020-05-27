#!/bin/sh
set -e

echo Start applying migrations...

# apply migration
npx prisma migrate up -c --experimental

echo Seeding data...

# seed data
npx ts-node seed.ts