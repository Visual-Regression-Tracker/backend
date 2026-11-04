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

const isPending = (value: Prisma.JsonValue): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && value.pending === true;

@Injectable()
export class NoiseHintService implements OnApplicationShutdown {
  private readonly logger: Logger = new Logger(NoiseHintService.name);
  private waiting: string[] = [];
  private known = new Set<string>();
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
    const sameSize = baselineSize && imageSize;
    if (sameSize && (baselineSize.width !== imageSize.width || baselineSize.height !== imageSize.height)) {
      return unknown('sizes differ');
    }
    if (!run.diffName) {
      return unknown('no diff');
    }
    if (sameSize && baselineSize.width * baselineSize.height > MAX_MEASURED_PIXELS) {
      return unknown('image too large');
    }

    const output = await this.diffWorkerPool.run({
      kind: 'blur-amplitude',
      baseline,
      image,
      ignoreAreas: parseIgnoreAreas(run.ignoreAreas).concat(parseIgnoreAreas(run.tempIgnoreAreas)),
      thresholds: thresholds.blur,
    });
    const { measure } = output;
    if (!measure) {
      return unknown('image too large');
    }

    const isNoise = looksLikeNoise(measure, thresholds.blur);
    const blur: BlurStageResult = {
      verdict: isNoise ? 'noise' : 'change',
      score: isNoise ? measure.amplitude / thresholds.blur.amplitudeThreshold : 1,
      signals: { amplitude: measure.amplitude, solidShare: measure.solidShare, density: output.density },
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
      dinov2 = await this.dinov2Stage(output.gate, baseline, image, thresholds, blur.score);
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
    const requested = [...new Set(ids)];
    const runs = new Map<string, RunWithProject>(
      (
        await this.prismaService.testRun.findMany({
          where: { id: { in: requested } },
          include: { project: true },
        })
      ).map((run) => [run.id, run])
    );

    const skipped: NoiseEnqueueResult['skipped'] = [];
    const accepted: string[] = [];
    for (const id of requested) {
      if (this.known.has(id)) {
        continue;
      }
      const reason = this.skipReason(runs.get(id));
      if (reason) {
        skipped.push({ id, reason });
      } else if (this.waiting.length + accepted.length >= MAX_WAITING) {
        skipped.push({ id, reason: 'queue full' });
      } else {
        accepted.push(id);
      }
    }

    if (accepted.length > 0) {
      const pending: NoiseAnalysisPending = { pending: true, requestedAt: new Date().toISOString() };
      await this.prismaService.testRun.updateMany({
        where: { id: { in: accepted } },
        data: { noiseAnalysis: pending as unknown as Prisma.InputJsonObject },
      });
      for (const id of accepted) {
        this.known.add(id);
        this.waiting.push(id);
      }
      void this.drain();
    }
    return { queued: accepted.length, skipped };
  }

  onApplicationShutdown(): void {
    this.waiting = [];
    this.known.clear();
  }

  private skipReason(run: RunWithProject | undefined): NoiseSkipReason | null {
    if (run?.status !== TestStatus.unresolved) {
      return 'not unresolved';
    }
    if (!run.project || run.project.imageComparison === ImageComparison.vlm) {
      return 'analysis off';
    }
    return parseNoiseAnalysisConfig(run.project.noiseAnalysisConfig).blur.enabled ? null : 'analysis off';
  }

  private async dinov2Stage(
    gate: PatchGate,
    baseline: Buffer,
    image: Buffer,
    thresholds: NoiseAnalysisThresholds,
    blurScore: number
  ): Promise<Dinov2Stage> {
    const measured = await this.dinov2Service.patchDistances(gate, baseline, image);
    if (!measured) {
      return { error: 'dinov2 unavailable' };
    }
    const { distanceThreshold } = thresholds.dinov2;
    const distance = strongestPatchDistance(measured.distances, gate.cells);
    const regions: NoiseRegion[] = gate.cells
      .map((cell) => ({ cell, weight: measured.distances[cell] }))
      .filter(({ weight }) => weight > distanceThreshold / 2)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_DINOV2_REGIONS)
      .map(({ cell, weight }) => ({
        x: (cell % gate.width) * DINOV2_PATCH,
        y: Math.floor(cell / gate.width) * DINOV2_PATCH,
        width: DINOV2_PATCH,
        height: DINOV2_PATCH,
        weight,
      }));
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
        this.known.delete(id);
      }
    } finally {
      this.draining = false;
    }
  }

  private async process(id: string): Promise<void> {
    try {
      const run = await this.prismaService.testRun.findUnique({ where: { id }, include: { project: true } });
      if (!run?.project || run.status !== TestStatus.unresolved || !isPending(run.noiseAnalysis)) {
        return;
      }
      const result = await this.analyse(run, parseNoiseAnalysisConfig(run.project.noiseAnalysisConfig));
      const updated = await this.prismaService.testRun.update({
        where: { id },
        data: { noiseAnalysis: result as unknown as Prisma.InputJsonObject },
      });
      this.eventsGateway.testRunUpdated(updated);
    } catch (error) {
      this.logger.error(`Noise analysis of test run ${id} failed: ${messageOf(error)}`);
      await this.prismaService.testRun
        .update({ where: { id }, data: { noiseAnalysis: Prisma.DbNull } })
        .then((updated) => this.eventsGateway.testRunUpdated(updated))
        .catch((resetError) => this.logger.error(`Could not reset test run ${id}: ${messageOf(resetError)}`));
    }
  }
}
