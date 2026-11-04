import fs from 'node:fs';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { TestStatus } from '@prisma/client';
import { StaticService } from '../src/static/static.service';
import { DiffWorkerPool } from '../src/compare/diff-worker-pool';
import { Dinov2Service } from '../src/compare/libs/dinov2/dinov2.service';
import { computePixelmatchDiff, PixelmatchJobInput } from '../src/compare/libs/pixelmatch/pixelmatch.core';
import { DEFAULT_CONFIG, PixelmatchService } from '../src/compare/libs/pixelmatch/pixelmatch.service';

export interface NoiseCase {
  name: string;
  bug: { id: string; category: string; severity: string } | null;
  baseline: string;
  image: string;
  dinov2: { width: number; height: number; cells: Record<string, number> };
}

const FIXTURES = path.join(__dirname, 'fixtures');
export const { cases }: { cases: NoiseCase[] } = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'cases.json'), 'utf8'));
const read = (file: string) => fs.readFileSync(path.join(FIXTURES, 'images', file));

const dinov2 = new Dinov2Service(new ConfigService({ DINOV2_URL: 'http://dinov2' }));
const confirmsNoiseForGate = dinov2.confirmsNoiseForGate.bind(dinov2);
const service = new PixelmatchService(
  { getImageBuffer: async (file: string) => read(file) } as unknown as StaticService,
  { run: async (job: PixelmatchJobInput) => computePixelmatchDiff(job) } as unknown as DiffWorkerPool
);

export async function verdict({ baseline, image, dinov2: recorded }: NoiseCase): Promise<TestStatus | undefined> {
  jest.spyOn(dinov2, 'confirmsNoiseForGate').mockImplementation((gate, ...images) => {
    const unrecorded = gate.cells.filter((cell) => !(cell in recorded.cells));
    if (unrecorded.length) {
      throw new Error(`no recorded DINOv2 distance for patches ${unrecorded.join(', ')}: re-export the fixtures`);
    }
    return confirmsNoiseForGate(gate, ...images);
  });
  const distances = new Array<number>(recorded.width * recorded.height).fill(0);
  for (const [cell, distance] of Object.entries(recorded.cells)) {
    distances[Number(cell)] = distance;
  }
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(Response.json({ width: recorded.width, height: recorded.height, distances }));
  const result = await service.getDiff(
    { baseline, image, diffTollerancePercent: 0, ignoreAreas: [], saveDiffAsFile: false },
    DEFAULT_CONFIG
  );
  return result.status;
}
