import { Injectable, Logger } from '@nestjs/common';
import { TestRun, TestStatus } from '@prisma/client';
import { StaticService } from '../static/static.service';
import { PrismaService } from '../prisma/prisma.service';
import { SignatureConfig, StampedSignature } from './diffResult';
import { TestRunDto } from './dto/testRun.dto';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { BoundedCache } from '../utils/bounded-cache';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { CompareService } from '../compare/compare.service';
import { signaturesMatch, SIGNATURE_LENGTH } from '../compare/libs/pixelmatch/signature.core';
import { messageOf } from '../utils/errors';
import { getAllIgnoreAreas } from './test-runs.shared';

@Injectable()
export class TestRunMatchingService {
  private readonly logger: Logger = new Logger(TestRunMatchingService.name);
  private readonly signatureCache = new BoundedCache<Promise<number[] | null>>(SIGNATURE_CACHE_SIZE);

  constructor(
    private prismaService: PrismaService,
    private staticService: StaticService,
    private compareService: CompareService
  ) {}

  private async findMatchingSiblings(testRun: TestRun): Promise<{ matching: TestRun[]; skipped: SkippedSibling[] }> {
    const project = testRun.projectId
      ? await this.prismaService.project.findUnique({ where: { id: testRun.projectId } })
      : null;
    if (!project?.bulkApproveVariations) {
      return { matching: [], skipped: [] };
    }

    const config = this.compareService.getSignatureConfig(project);

    const groupBy = resolveGroupByAxis(project.bulkApproveGroupBy);
    const fixedAxes: Record<string, string | null> = {};
    for (const axis of GROUP_BY_AXES) {
      if (axis !== groupBy) {
        fixedAxes[axis] = testRun[axis] ?? null;
      }
    }

    const siblings = await this.prismaService.testRun.findMany({
      where: {
        id: { not: testRun.id },
        buildId: testRun.buildId,
        branchName: testRun.branchName,
        name: testRun.name,
        ...fixedAxes,
        status: { in: [TestStatus.unresolved, TestStatus.new] },
      },
    });

    const candidates = siblings.filter(
      (sibling) => !!sibling.diffPercent && magnitudesSimilar(testRun.diffPercent, sibling.diffPercent)
    );
    const [referenceSignature, ...candidateSignatures] = await mapWithConcurrency(
      [testRun, ...candidates],
      SIGNATURE_CONCURRENCY,
      (run) => this.getChangeSignature(run, config)
    );

    if (!referenceSignature) {
      return {
        matching: [],
        skipped: siblings.map((run) => ({ run, reason: 'no reference diff' })),
      };
    }

    const signatures = new Map(candidates.map((sibling, index) => [sibling.id, candidateSignatures[index]] as const));
    const matching: TestRun[] = [];
    const skipped: SkippedSibling[] = [];
    for (const sibling of siblings) {
      const signature = signatures.get(sibling.id);
      let reason: string | null = null;
      if (!sibling.diffPercent || signature === null) {
        reason = 'no diff to match';
      } else if (signature === undefined) {
        reason = 'different change size';
      } else if (!signaturesMatch(referenceSignature, signature)) {
        reason = 'different change pattern';
      }
      if (reason) {
        skipped.push({ run: sibling, reason });
      } else {
        matching.push(sibling);
      }
    }

    return { matching, skipped };
  }

  async getMatchingVariations(testRun: TestRun): Promise<MatchingVariations> {
    const { matching, skipped } = await this.findMatchingSiblings(testRun);
    const variations = [testRun, ...matching].map((run) => new TestRunDto(run));
    const skippedDto = skipped.map((item) => ({ ...new TestRunDto(item.run), reason: item.reason }));
    return { variations, skipped: skippedDto };
  }

  private async getChangeSignature(testRun: TestRun, config: SignatureConfig): Promise<number[] | null> {
    const stored = parseStoredSignature(testRun.changeSignature, config, this.logger);
    if (stored) {
      return stored;
    }
    if (!testRun.baselineName) {
      return null;
    }
    const ignoreAreas = getAllIgnoreAreas(testRun);
    const key = [
      testRun.baselineName,
      testRun.imageName,
      config.threshold,
      config.includeAA,
      JSON.stringify(ignoreAreas),
    ].join('|');
    const cached = this.signatureCache.get(key);
    if (cached) {
      return cached;
    }

    const pending = this.computeChangeSignature(testRun, ignoreAreas, config);
    this.signatureCache.set(key, pending);
    pending.catch(() => this.signatureCache.delete(key));
    return pending;
  }

  private async computeChangeSignature(
    testRun: TestRun,
    ignoreAreas: IgnoreAreaDto[],
    config: SignatureConfig
  ): Promise<number[] | null> {
    const [baseline, image] = await Promise.all([
      this.staticService.getImageBuffer(testRun.baselineName),
      this.staticService.getImageBuffer(testRun.imageName),
    ]);
    if (!baseline || !image) {
      return null;
    }
    const { signature } = await this.compareService.getChangeSignature({
      baseline,
      image,
      ignoreAreas,
      threshold: config.threshold,
      includeAA: config.includeAA,
    });
    return signature;
  }
}

export interface MatchingVariations {
  variations: TestRunDto[];
  skipped: Array<TestRunDto & { reason: string }>;
}

interface SkippedSibling {
  run: TestRun;
  reason: string;
}

const GROUP_BY_AXES = ['customTags', 'os', 'device', 'browser', 'viewport'] as const;

function resolveGroupByAxis(value: string | null | undefined): string {
  return value && (GROUP_BY_AXES as readonly string[]).includes(value) ? value : 'customTags';
}

export const SIGNATURE_CONCURRENCY = 8;

const SIGNATURE_CACHE_SIZE = 2000;

function parseStoredSignature(
  stored: string | null | undefined,
  config: SignatureConfig,
  logger: Logger
): number[] | null {
  if (!stored) {
    return null;
  }
  try {
    const parsed: StampedSignature = JSON.parse(stored);
    const wellFormed =
      Array.isArray(parsed?.signature) &&
      parsed.signature.length === SIGNATURE_LENGTH &&
      parsed.signature.every((value) => typeof value === 'number' && Number.isFinite(value));
    if (!wellFormed) {
      return null;
    }
    const sameConfig = parsed.threshold === config.threshold && parsed.includeAA === config.includeAA;
    return sameConfig ? parsed.signature : null;
  } catch (error) {
    logger.warn(`Ignoring unreadable stored change signature: ${messageOf(error)}`);
    return null;
  }
}

const MATCH_MAGNITUDE_RATIO = 2;

function magnitudesSimilar(a: number | null, b: number | null): boolean {
  const min = Math.min(a ?? 0, b ?? 0);
  const max = Math.max(a ?? 0, b ?? 0);
  if (min <= 0) {
    return max <= 0;
  }
  return max / min <= MATCH_MAGNITUDE_RATIO;
}
