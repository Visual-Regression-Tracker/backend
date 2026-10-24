import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { TestVariationsService } from '../../test-variations/test-variations.service';

// Advisory lock key of the cleanup, shared by every instance against the same
// database: "VRT" and 1, a value nothing else in the database locks on
export const CLEANUP_LOCK_KEY = 0x56525401;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prismaService: PrismaService,
    @Inject(forwardRef(() => TestVariationsService))
    private testVariationService: TestVariationsService
  ) {}

  /**
   * Every API instance schedules this for the same midnight. One of them runs
   * it and the others skip, or they would race to delete the same variations
   * and baseline images.
   *
   * The lock is a transaction-level advisory lock, taken on a connection of
   * its own and held in an otherwise idle transaction until the cleanup is
   * done. Taking it only to claim the run and committing before the work would
   * let an instance whose timer fires a moment later run alongside; a
   * session-level lock behind a PgBouncer in transaction mode would stay on
   * whichever server connection took it. This one goes with the transaction,
   * which ends with the connection, also when the instance dies. The
   * transaction holds no rows and, between statements, no snapshot, so it does
   * not hold up vacuum; the deletions go through Prisma's pool as usual. An
   * instance that comes after the run has finished finds nothing left to remove.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanOldTestVariations() {
    const client = this.prismaService.dedicatedClient();
    // an idle pg client emits a lost connection as an event, which would
    // otherwise crash the process; the lock goes with it, the cleanup goes on
    client.on('error', (error) => this.logger.warn(`Lost the cleanup lock connection: ${error.message}`));
    await client.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        CLEANUP_LOCK_KEY,
      ]);
      if (!rows[0].locked) {
        this.logger.log('Another instance is removing old test variations, skipping');
        return;
      }
      await this.removeOldTestVariations();
    } finally {
      // closing the connection rolls the transaction back and releases the lock
      await client.end();
    }
  }

  /**
   * Feature-branch variations nobody has used within the project's
   * maxBranchLifetime. Use is an approval or edit of the variation (its
   * updatedAt) or a test run compared against it: a run that matches its
   * baseline leaves the variation untouched, yet the branch is plainly alive,
   * and dropping its baseline would turn its next run into "new".
   */
  private async removeOldTestVariations() {
    const projects = await this.prismaService.project.findMany();

    for (const project of projects) {
      const dateRemoveAfter: Date = new Date();
      dateRemoveAfter.setDate(dateRemoveAfter.getDate() - project.maxBranchLifetime);

      const testVariations = await this.prismaService.testVariation.findMany({
        where: {
          projectId: project.id,
          updatedAt: { lte: dateRemoveAfter },
          testRuns: { none: { createdAt: { gt: dateRemoveAfter } } },
          branchName: { not: project.mainBranchName },
        },
      });
      this.logger.debug(
        `Removing ${testVariations.length} TestVariations for ${project.name} unused since ${dateRemoveAfter}`
      );

      for (const testVariation of testVariations) {
        await this.testVariationService.delete(testVariation.id);
      }
    }
  }
}
