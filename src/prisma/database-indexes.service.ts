import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Indexes for the columns the test-run queries filter on. The migrations create only primary
 * keys and unique constraints, so listing a build's test runs (and the approve / auto-approve
 * lookups of earlier runs) scanned the whole TestRun table, which grows with every run.
 *
 * Created at startup, in the background, with CONCURRENTLY so a large table stays writable while
 * an index is built. A build that fails leaves an INVALID index behind, which IF NOT EXISTS would
 * then keep forever: it is dropped and built again.
 */
export const DATABASE_INDEXES: ReadonlyArray<{ name: string; definition: string }> = [
  { name: 'TestRun_buildId_idx', definition: '"TestRun"("buildId")' },
  { name: 'TestRun_testVariationId_idx', definition: '"TestRun"("testVariationId")' },
  { name: 'TestRun_projectId_branchName_name_idx', definition: '"TestRun"("projectId", "branchName", "name")' },
  { name: 'Baseline_testVariationId_idx', definition: '"Baseline"("testVariationId")' },
];

@Injectable()
export class DatabaseIndexesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseIndexesService.name);

  constructor(private readonly prismaService: PrismaService) {}

  onApplicationBootstrap(): void {
    void this.ensureIndexes();
  }

  async ensureIndexes(): Promise<void> {
    for (const { name, definition } of DATABASE_INDEXES) {
      try {
        if (await this.isInvalid(name)) {
          this.logger.warn(`Index ${name} is invalid, building it again`);
          await this.prismaService.$executeRaw(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
        }
        await this.prismaService.$executeRaw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ON ${definition}`);
        this.logger.log(`Index ${name} is in place`);
      } catch (error) {
        this.logger.error(`Index ${name} could not be created: ${error?.message}`);
      }
    }
  }

  private async isInvalid(name: string): Promise<boolean> {
    const rows: Array<{ valid: boolean }> = await this.prismaService.$queryRaw(
      'SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1',
      name
    );
    return rows.length > 0 && !rows[0].valid;
  }
}
