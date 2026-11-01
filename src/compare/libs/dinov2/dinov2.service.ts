import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PatchGate } from '../pixelmatch/patch-gate.core';
import { positiveNumber } from '../../../utils/env';
import { messageOf } from '../../../utils/errors';

const TILE_PATCHES = 16;
const DEFAULT_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 3_000;

export interface Dinov2Status {
  configured: boolean;
  available: boolean;
}

interface Dinov2Verdict {
  noise: boolean;
  score?: number;
}

export function blobScore(distances: number[], width: number, height: number, cells: number[]): number {
  const marked = new Set(cells);
  const at = (row: number, col: number) =>
    row >= 0 && row < height && col >= 0 && col < width && marked.has(row * width + col)
      ? distances[row * width + col]
      : 0;
  let score = 0;
  for (const cell of cells) {
    const row = Math.floor(cell / width);
    const col = cell % width;
    const neighbour = Math.max(at(row - 1, col), at(row + 1, col), at(row, col - 1), at(row, col + 1));
    score = Math.max(score, Math.min(distances[cell], neighbour));
  }
  return score;
}

export function tilesOf(cells: number[], width: number): [number, number][] {
  const tiles = new Map<string, [number, number]>();
  for (const cell of cells) {
    const tile: [number, number] = [
      Math.floor(Math.floor(cell / width) / TILE_PATCHES),
      Math.floor((cell % width) / TILE_PATCHES),
    ];
    tiles.set(tile.join(','), tile);
  }
  return [...tiles.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

@Injectable()
export class Dinov2Service {
  private readonly logger: Logger = new Logger(Dinov2Service.name);

  constructor(private readonly configService: ConfigService) {}

  async status(): Promise<Dinov2Status> {
    const url = this.serviceUrl();
    if (!url) {
      return { configured: false, available: false };
    }
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
      return { configured: true, available: response.ok };
    } catch (error) {
      this.logger.warn(`DINOv2 service is not answering: ${messageOf(error)}`);
      return { configured: true, available: false };
    }
  }

  async confirmsNoiseForGate(
    gate: PatchGate,
    baseline: Buffer,
    image: Buffer,
    threshold: number
  ): Promise<Dinov2Verdict> {
    const url = this.serviceUrl();
    if (!url) {
      this.logger.warn('dinov2Check is on but DINOV2_URL is not set: the run goes to review');
      return { noise: false };
    }
    if (gate.cells.length === 0) {
      return { noise: true, score: 0 };
    }
    try {
      const response = await fetch(`${url}/v1/patch-distances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseline: baseline.toString('base64'),
          image: image.toString('base64'),
          tiles: tilesOf(gate.cells, gate.width),
        }),
        signal: AbortSignal.timeout(positiveNumber(this.configService.get('DINOV2_TIMEOUT_MS'), DEFAULT_TIMEOUT_MS)),
      });
      if (!response.ok) {
        throw new Error(`service answered ${response.status}`);
      }
      const answer: { width: number; height: number; distances: number[] } = await response.json();
      if (answer.width !== gate.width || answer.height !== gate.height) {
        throw new Error(
          `service measured ${answer.width}x${answer.height} patches, expected ${gate.width}x${gate.height}`
        );
      }

      const score = blobScore(answer.distances, gate.width, gate.height, gate.cells);
      return { noise: score <= threshold, score };
    } catch (error) {
      this.logger.warn(`DINOv2 check failed, the run goes to review: ${messageOf(error)}`);
      return { noise: false };
    }
  }

  private serviceUrl(): string | undefined {
    return this.configService.get<string>('DINOV2_URL')?.replace(/\/$/, '') || undefined;
  }
}
