import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ImageComparison, Prisma, TestRun, TestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StaticService } from '../../static/static.service';
import { EventsGateway } from '../../shared/events/events.gateway';
import { readPngDimensions } from '../../static/utils';
import { parseIgnoreAreas } from '../../utils';
import { messageOf } from '../../utils/errors';
import { DiffWorkerPool } from '../diff-worker-pool';
import { Dinov2Service, strongestPatchDistance } from '../libs/dinov2/dinov2.service';
import { looksLikeNoise, MAX_MEASURED_PIXELS } from '../libs/pixelmatch/blur-amplitude.core';
import { DINOV2_PATCH, PatchGate } from '../libs/pixelmatch/patch-gate.core';
import { NoiseAnalysisConfig, parseNoiseAnalysisConfig } from './noise-analysis.config';
import {
  BlurStageResult,
  Dinov2Stage,
  NoiseAnalysisPending,
  NoiseAnalysisResult,
  NoiseAnalysisThresholds,
  NoiseRegion,
  NoiseUnknownReason,
  readNoiseAnalysis,
} from './noise-analysis.types';

const RESULT_VERSION = 1;
const MAX_WAITING = 256;
const MAX_DINOV2_REGIONS = 10;

export type NoiseSkipReason = 'not unresolved' | 'analysis off' | 'queue full';

export interface NoiseEnqueueResult {
  queued: number;
  skipped: { id: string; reason: NoiseSkipReason }[];
}

type RunWithProject = Prisma.TestRunGetPayload<{ include: { project: true } }>;

const thresholdsOf = (config: NoiseAnalysisConfig): NoiseAnalysisThresholds => ({
  blur: { amplitudeThreshold: config.blur.amplitudeThreshold, solidShareMax: config.blur.solidShareMax },
  dinov2: { distanceThreshold: config.dinov2.distanceThreshold },
});

const pendingSince = (value: Prisma.JsonValue): string | undefined => {
  const analysis = readNoiseAnalysis(value);
  return analysis && 'pending' in analysis ? analysis.requestedAt : undefined;
};

const markedAt = (requestedAt: string): Prisma.TestRunWhereInput => ({
  noiseAnalysis: { path: ['requestedAt'], equals: requestedAt },
});

const ANY_PENDING: Prisma.TestRunWhereInput = { noiseAnalysis: { path: ['pending'], equals: true } };

@Injectable()
export class NoiseHintService implements OnApplicationShutdown {
  private readonly logger: Logger = new Logger(NoiseHintService.name);
  private waiting: string[] = [];
  private known = new Set<string>();
  private requeue = new Set<string>();
  private reserved = 0;
  private draining = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly staticService: StaticService,
    private readonly diffWorkerPool: DiffWorkerPool,
    private readonly dinov2Service: Dinov2Service,
    private readonly eventsGateway: EventsGateway
  ) {}

  async analyse(run: TestRun, config: NoiseAnalysisConfig): Promise<NoiseAnalysisResult> {
    const thresholds = thresholdsOf(config);
    const unknown = (reason: NoiseUnknownReason): NoiseAnalysisResult => ({
      version: RESULT_VERSION,
      verdict: 'unknown',
      score: null,
      reason,
      config: thresholds,
      blur: null,
      dinov2: null,
      computedAt: new Date().toISOString(),
    });

    const [baseline, image] = await Promise.all([
      this.staticService.getImageBuffer(run.baselineName),
      this.staticService.getImageBuffer(run.imageName),
    ]);
    if (!baseline || !image) {
      return unknown('no diff');
    }
    const baselineSize = readPngDimensions(baseline);
    const imageSize = readPngDimensions(image);
    const measurable = baselineSize && imageSize;
    if (measurable && (baselineSize.width !== imageSize.width || baselineSize.height !== imageSize.height)) {
      return unknown('sizes differ');
    }
    if (!run.diffName) {
      return unknown('no diff');
    }
    if (measurable && baselineSize.width * baselineSize.height > MAX_MEASURED_PIXELS) {
      return unknown('image too large');
    }

    const output = await this.diffWorkerPool.run({
      kind: 'blur-amplitude',
      baseline,
      image,
      ignoreAreas: parseIgnoreAreas(run.ignoreAreas).concat(parseIgnoreAreas(run.tempIgnoreAreas)),
      thresholds: thresholds.blur,
      wantGate: config.dinov2.enabled && this.dinov2Service.isConfigured(),
    });
    const { measure } = output;
    if (!measure) {
      return unknown(output.unmeasured === 'sizes differ' ? 'sizes differ' : 'image too large');
    }

    const isNoise = looksLikeNoise(measure, thresholds.blur);
    const blur: BlurStageResult = {
      verdict: isNoise ? 'noise' : 'change',
      score: isNoise ? measure.amplitude / thresholds.blur.amplitudeThreshold : 1,
      signals: {
        amplitude: measure.amplitude,
        solidShare: measure.solidShare,
        density: output.densest[0]?.weight ?? 0,
      },
      regions: output.densest,
    };

    let dinov2: Dinov2Stage;
    if (!isNoise) {
      dinov2 = { skipped: 'blur sees a change' };
    } else if (!config.dinov2.enabled || !this.dinov2Service.isConfigured()) {
      dinov2 = { skipped: 'off' };
    } else if (!output.gate) {
      throw new Error('Blur job returned no patch gate for a pair it takes for noise');
    } else {
      dinov2 = await this.dinov2Stage(
        output.gate,
        baseline,
        image,
        thresholds.dinov2.distanceThreshold,
        blur.score,
        baselineSize
      );
    }

    const last = 'verdict' in dinov2 ? dinov2 : blur;
    return {
      version: RESULT_VERSION,
      verdict: last.verdict,
      score: last.score,
      reason: null,
      config: thresholds,
      blur,
      dinov2,
      computedAt: new Date().toISOString(),
    };
  }

  async enqueue(ids: string[]): Promise<NoiseEnqueueResult> {
    const unique = [...new Set(ids)];
    const fresh = unique.filter((id) => !this.known.has(id));
    fresh.forEach((id) => this.known.add(id));
    const freshIds = new Set(fresh);

    const skipped: NoiseEnqueueResult['skipped'] = [];
    const accepted: string[] = [];
    let reservations = 0;
    const parsed = new Map<string, NoiseAnalysisConfig>();
    const configOf = (json: string): NoiseAnalysisConfig => {
      let config = parsed.get(json);
      if (!config) {
        config = parseNoiseAnalysisConfig(json);
        parsed.set(json, config);
      }
      return config;
    };
    try {
      const runs = new Map<string, RunWithProject>(
        (
          await this.prismaService.testRun.findMany({
            where: { id: { in: unique } },
            include: { project: true },
          })
        ).map((run) => [run.id, run])
      );
      for (const id of unique) {
        const run = runs.get(id);
        const reason = this.skipReason(run, run?.project ? configOf(run.project.noiseAnalysisConfig) : undefined);
        if (reason) {
          skipped.push({ id, reason });
        } else if (!freshIds.has(id)) {
          accepted.push(id);
        } else if (this.waiting.length + this.reserved >= MAX_WAITING) {
          skipped.push({ id, reason: 'queue full' });
        } else {
          accepted.push(id);
          this.reserved += 1;
          reservations += 1;
        }
      }
      skipped.forEach(({ id }) => freshIds.has(id) && this.known.delete(id));

      if (accepted.length > 0) {
        const pending: NoiseAnalysisPending = { pending: true, requestedAt: new Date().toISOString() };
        const { count } = await this.prismaService.testRun.updateMany({
          where: { id: { in: accepted }, status: TestStatus.unresolved },
          data: { noiseAnalysis: pending as unknown as Prisma.InputJsonObject },
        });
        if (count > 0) {
          await this.announcePending(accepted, pending.requestedAt);
        }
      }
    } catch (error) {
      fresh.forEach((id) => (this.requeue.delete(id) ? this.waiting.push(id) : this.known.delete(id)));
      this.reserved -= reservations;
      if (this.waiting.length > 0) {
        void this.drain();
      }
      throw error;
    }

    this.reserved -= reservations;
    accepted.forEach((id) => this.place(id, freshIds.has(id)));
    if (accepted.length > 0) {
      void this.drain();
    }
    return { queued: accepted.length, skipped };
  }

  onApplicationShutdown(): void {
    this.waiting = [];
    this.known.clear();
    this.requeue.clear();
  }

  private place(id: string, fresh: boolean): void {
    if (fresh || !this.known.has(id)) {
      this.known.add(id);
      this.waiting.push(id);
    } else if (!this.waiting.includes(id)) {
      this.requeue.add(id);
    }
  }

  private skipReason(run: RunWithProject | undefined, config: NoiseAnalysisConfig | undefined): NoiseSkipReason | null {
    if (run?.status !== TestStatus.unresolved) {
      return 'not unresolved';
    }
    if (!run.project || run.project.imageComparison === ImageComparison.vlm) {
      return 'analysis off';
    }
    return config?.blur.enabled ? null : 'analysis off';
  }

  private async announcePending(ids: string[], requestedAt: string): Promise<void> {
    try {
      const marked = await this.prismaService.testRun.findMany({
        where: {
          id: { in: ids },
          status: TestStatus.unresolved,
          ...markedAt(requestedAt),
        },
      });
      marked.forEach((run) => {
        try {
          this.eventsGateway.testRunUpdated(run);
        } catch (error) {
          this.logger.error(`Could not announce test run ${run.id} queued for noise analysis: ${messageOf(error)}`);
        }
      });
    } catch (error) {
      this.logger.error(`Could not announce runs queued for noise analysis: ${messageOf(error)}`);
    }
  }

  private async dinov2Stage(
    gate: PatchGate,
    baseline: Buffer,
    image: Buffer,
    distanceThreshold: number,
    blurScore: number,
    size: { width: number; height: number } | null
  ): Promise<Dinov2Stage> {
    const distances = await this.dinov2Service.patchDistances(gate, baseline, image);
    if (!distances) {
      return { error: 'dinov2 unavailable' };
    }
    const distance = strongestPatchDistance(distances, gate.cells);
    const regions: NoiseRegion[] = gate.cells
      .map((cell) => ({ cell, weight: distances[cell] }))
      .filter(({ weight }) => weight > distanceThreshold / 2)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_DINOV2_REGIONS)
      .map(({ cell, weight }) => {
        const x = (cell % gate.width) * DINOV2_PATCH;
        const y = Math.floor(cell / gate.width) * DINOV2_PATCH;
        return {
          x,
          y,
          width: size ? Math.min(DINOV2_PATCH, size.width - x) : DINOV2_PATCH,
          height: size ? Math.min(DINOV2_PATCH, size.height - y) : DINOV2_PATCH,
          weight,
        };
      });
    return {
      verdict: distance > distanceThreshold ? 'change' : 'noise',
      score: Math.max(blurScore, Math.min(1, distance / (2 * distanceThreshold))),
      signals: { distance, patches: gate.cells.length },
      regions,
    };
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      for (let id = this.waiting.shift(); id !== undefined; id = this.waiting.shift()) {
        await this.process(id);
        if (this.requeue.delete(id)) {
          this.waiting.push(id);
        } else {
          this.known.delete(id);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async process(id: string): Promise<void> {
    let requestedAt: string | undefined;
    try {
      const run = await this.prismaService.testRun.findUnique({ where: { id }, include: { project: true } });
      requestedAt = run ? pendingSince(run.noiseAnalysis) : undefined;
      if (!run?.project || !requestedAt) {
        return;
      }
      const config = parseNoiseAnalysisConfig(run.project.noiseAnalysisConfig);
      const marker = markedAt(requestedAt);
      if (this.skipReason(run, config)) {
        await this.replaceMarker(id, Prisma.DbNull, marker);
        return;
      }
      const result = await this.analyse(run, config);
      const stored = await this.replaceMarker(id, result as unknown as Prisma.InputJsonObject, marker, {
        status: TestStatus.unresolved,
      });
      if (!stored) {
        await this.replaceMarker(id, Prisma.DbNull, marker);
      }
    } catch (error) {
      this.logger.error(`Noise analysis of test run ${id} failed: ${messageOf(error)}`);
      await this.replaceMarker(id, Prisma.DbNull, requestedAt ? markedAt(requestedAt) : ANY_PENDING).catch(
        (resetError) => this.logger.error(`Could not reset test run ${id}: ${messageOf(resetError)}`)
      );
    }
  }

  private async replaceMarker(
    id: string,
    value: Prisma.InputJsonValue | typeof Prisma.DbNull,
    marker: Prisma.TestRunWhereInput,
    where: Prisma.TestRunWhereInput = {}
  ): Promise<boolean> {
    const { count } = await this.prismaService.testRun.updateMany({
      where: { ...where, id, ...marker },
      data: { noiseAnalysis: value },
    });
    if (count === 0) {
      return false;
    }
    const updated = await this.prismaService.testRun.findUnique({ where: { id } });
    if (updated) {
      this.eventsGateway.testRunUpdated(updated);
    }
    return true;
  }
}
