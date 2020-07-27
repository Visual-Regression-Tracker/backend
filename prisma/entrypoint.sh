#!/bin/sh
set -e

/app/wait-for-it.sh postgres:5432 -- echo Postgress is up!

echo Start applying migrations...

# apply migration
npx prisma migrate up -c --experimental

echo Seeding data...

# seed data
npx ts-node seed.ts