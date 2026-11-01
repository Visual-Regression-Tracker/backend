import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, Project } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TestVariationsService } from '../../test-variations/test-variations.service';
import type { WrapperType } from '../wrapper-type';

export const CLEANUP_LOCK_KEY = 0x56525401;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prismaService: PrismaService,
    @Inject(forwardRef(() => TestVariationsService))
    private testVariationService: WrapperType<TestVariationsService>
  ) {}

  // Transaction-level lock on a dedicated connection: a session-level one would stick to a PgBouncer connection
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanOldTestVariations() {
    const client = this.prismaService.dedicatedClient();
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
      await client.end();
    }
  }

  private async removeOldTestVariations() {
    const projects = await this.prismaService.project.findMany();

    for (const project of projects) {
      try {
        await this.removeOldTestVariationsOf(project);
      } catch (e) {
        this.logger.warn(`Cannot clean up TestVariations of ${project.name}: ${e}`);
      }
    }
  }

  private async removeOldTestVariationsOf(project: Project) {
    const dateRemoveAfter: Date = new Date();
    dateRemoveAfter.setDate(dateRemoveAfter.getDate() - project.maxBranchLifetime);

    const testVariations = await this.prismaService.testVariation.findMany({
      where: this.staleVariationsWhere(project, dateRemoveAfter),
    });
    this.logger.debug(
      `Removing ${testVariations.length} TestVariations for ${project.name} unused since ${dateRemoveAfter}`
    );

    let removed = 0;
    let skipped = 0;
    let failed = 0;
    for (const testVariation of testVariations) {
      try {
        const stillStale = await this.prismaService.testVariation.findFirst({
          where: { id: testVariation.id, ...this.staleVariationsWhere(project, dateRemoveAfter) },
          select: { id: true },
        });
        if (!stillStale) {
          skipped++;
          continue;
        }
        await this.testVariationService.delete(testVariation.id);
        removed++;
      } catch (e) {
        failed++;
        this.logger.warn(`Cannot remove TestVariation ${testVariation.id}: ${e}`);
      }
    }
    this.logger.log(
      `Removed ${removed} of ${testVariations.length} TestVariations of ${project.name}, ${skipped} in use again, ${failed} failed`
    );
  }

  private staleVariationsWhere(project: Project, removeAfter: Date): Prisma.TestVariationWhereInput {
    return {
      projectId: project.id,
      updatedAt: { lte: removeAfter },
      testRuns: { none: { createdAt: { gt: removeAfter } } },
      branchName: { not: project.mainBranchName },
    };
  }
}
