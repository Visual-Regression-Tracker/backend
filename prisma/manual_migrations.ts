import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  // log: ['query'],
});

async function dbSchemaExists(): Promise<boolean> {
  return prisma.$queryRaw`SELECT EXISTS 
  (
    SELECT 1
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    AND table_name = '_Migration'
  )`
    .catch(() => false)
    .then((result) => (result as Array<{ exists: boolean }>).shift()?.exists);
}

async function shouldSkipMigration(migrationKey: string): Promise<boolean> {
  return prisma.$queryRaw`
  SELECT revision, status from "public"."_Migration" 
  WHERE "name" like ${`%${migrationKey}%`}
  AND "status" = 'MigrationSuccess'
  LIMIT 1`.then((migration) => migration?.length > 0);
}

//https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker/issues/243
async function setEmptyTestVariationTags_github_243() {
  const migrationKey = 'github_243';
  if (await shouldSkipMigration(migrationKey)) {
    console.info(`Skipping migration ${migrationKey}...`);
    return;
  }
  console.info(`Going to apply migration ${migrationKey}...`);
  const testVariations = await prisma.testVariation.findMany({
    where: {
      OR: [
        {
          os: null,
        },
        {
          device: null,
        },
        {
          browser: null,
        },
        {
          viewport: null,
        },
      ],
    },
  });

  return Promise.all(
    testVariations.map((testVariation) =>
      prisma.testVariation.update({
        where: { id: testVariation.id },
        data: {
          os: testVariation.os ?? '',
          device: testVariation.device ?? '',
          browser: testVariation.browser ?? '',
          viewport: testVariation.viewport ?? '',
        },
      })
    )
  ).then(() => console.info(`Finished migration ${migrationKey}`));
}

async function manualMigrations() {
  await prisma.$connect();
  if (await dbSchemaExists()) {
    console.info('Apply migrations...');
    await setEmptyTestVariationTags_github_243();
  } else {
    console.info('DB schema not found. Skipping manual migrations...');
  }

  await prisma.$disconnect();
}

manualMigrations()
  .catch((e) => console.error('Cannot run manual migrations:', e))
  .finally(async () => await prisma.$disconnect());
