import { DATABASE_INDEXES, DatabaseIndexesService } from './database-indexes.service';
import { PrismaService } from './prisma.service';

function serviceWith({ invalid = [] as string[], failOn = '' } = {}) {
  const statements: string[] = [];
  const prisma = {
    $queryRaw: jest.fn(async (_query: string, name: string) => (invalid.includes(name) ? [{ valid: false }] : [])),
    $executeRaw: jest.fn(async (statement: string) => {
      statements.push(statement);
      if (failOn && statement.includes(failOn)) throw new Error('refused');
      return 0;
    }),
  };
  return { service: new DatabaseIndexesService(prisma as unknown as PrismaService), statements };
}

describe('DatabaseIndexesService', () => {
  it('creates each index concurrently, only when it does not exist yet', async () => {
    const { service, statements } = serviceWith();

    await service.ensureIndexes();

    expect(statements).toEqual(
      DATABASE_INDEXES.map(
        ({ name, definition }) => `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ON ${definition}`
      )
    );
    expect(statements.join('\n')).toContain('"TestRun"("buildId")');
  });

  it('builds an index left invalid by a failed build again', async () => {
    const { service, statements } = serviceWith({ invalid: ['TestRun_buildId_idx'] });

    await service.ensureIndexes();

    expect(statements.slice(0, 2)).toEqual([
      'DROP INDEX CONCURRENTLY IF EXISTS "TestRun_buildId_idx"',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "TestRun_buildId_idx" ON "TestRun"("buildId")',
    ]);
  });

  it('keeps going when one index cannot be created', async () => {
    const { service, statements } = serviceWith({ failOn: 'TestRun_buildId_idx' });

    await expect(service.ensureIndexes()).resolves.toBeUndefined();

    expect(statements).toHaveLength(DATABASE_INDEXES.length);
  });
});
