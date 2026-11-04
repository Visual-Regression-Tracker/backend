import fs from 'node:fs';
import path from 'node:path';
import { generateTestRun } from '../src/_data_';
import { DiffWorkerPool } from '../src/compare/diff-worker-pool';
import { Dinov2Service } from '../src/compare/libs/dinov2/dinov2.service';
import { DEFAULT_NOISE_ANALYSIS_CONFIG } from '../src/compare/noise-hint/noise-analysis.config';
import { NoiseAnalysisResult } from '../src/compare/noise-hint/noise-analysis.types';
import { NoiseHintService } from '../src/compare/noise-hint/noise-hint.service';
import { EventsGateway } from '../src/shared/events/events.gateway';
import { PrismaService } from '../src/prisma/prisma.service';
import { StaticService } from '../src/static/static.service';

export interface NoiseCase {
  name: string;
  bug: { id: string; category: string; severity: string } | null;
  baseline: string;
  image: string;
  dinov2: { width: number; height: number; cells: Record<string, number> };
}

const FIXTURES = path.join(__dirname, 'fixtures');
export const { cases }: { cases: NoiseCase[] } = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'cases.json'), 'utf8'));

const pool = new DiffWorkerPool();
const images = new Map<string, Buffer>();
let recorded: NoiseCase['dinov2'];

const staticService = {
  getImageBuffer: async (file: string) => {
    let buffer = images.get(file);
    if (!buffer) {
      buffer = fs.readFileSync(path.join(FIXTURES, 'images', file));
      images.set(file, buffer);
    }
    return buffer;
  },
} as unknown as StaticService;

const dinov2Service = {
  isConfigured: () => true,
  patchDistances: async (gate) => {
    const unrecorded = gate.cells.filter((cell) => !(cell in recorded.cells));
    if (unrecorded.length) {
      throw new Error(`no recorded DINOv2 distance for patches ${unrecorded.join(', ')}: re-export the fixtures`);
    }
    if (gate.width !== recorded.width || gate.height !== recorded.height) {
      throw new Error(`gate is ${gate.width}x${gate.height} patches, recorded ${recorded.width}x${recorded.height}`);
    }
    const distances = new Array<number>(recorded.width * recorded.height).fill(0);
    for (const [cell, distance] of Object.entries(recorded.cells)) {
      distances[Number(cell)] = distance;
    }
    return { distances, width: recorded.width, height: recorded.height };
  },
} as Pick<Dinov2Service, 'isConfigured' | 'patchDistances'>;

const service = new NoiseHintService(
  {} as PrismaService,
  staticService,
  pool,
  dinov2Service as Dinov2Service,
  {} as EventsGateway
);

export async function analyse(c: NoiseCase): Promise<NoiseAnalysisResult> {
  recorded = c.dinov2;
  const run = generateTestRun({ baselineName: c.baseline, imageName: c.image, diffName: 'diff.png' });
  return service.analyse(run, DEFAULT_NOISE_ANALYSIS_CONFIG);
}

export const closeBench = () => pool.onApplicationShutdown();
