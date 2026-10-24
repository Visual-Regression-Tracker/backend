import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { DiffWorkerPool } from '../../diff-worker-pool';

// the model's patch size, and the patches along one side of a 224 px tile
const PATCH = 14;
const TILE_PATCHES = 16;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface Dinov2Verdict {
  // true only when DINOv2 looked and saw no change of content
  noise: boolean;
  // the strongest content change where pixelmatch saw one, when it looked
  score?: number;
}

/**
 * The strongest content distance among the patches pixelmatch marked, counting
 * a patch only when a marked neighbour (up, down, left, right) changed too:
 * a change worth a reviewer covers more than one 14 px patch, a stray patch is
 * how anti-aliasing shows up. The score is the weaker of the pair.
 */
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

/** The 224 px tiles, as [row, col], that hold at least one marked patch. */
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

/**
 * A second look at a change the blur filter would pass as rendering noise:
 * the DINOv2 service compares the two screenshots' content patch by patch,
 * which catches what is faint in pixels but clear in meaning — a missing light
 * icon, a removed input border. Calibrated in research/jepa-screenshot-diff.
 *
 * The check exists to stop the filter passing a real change, so whenever it
 * cannot look — no service configured, the service down, screenshots that do
 * not line up — it does not confirm noise and the run goes to review.
 */
@Injectable()
export class Dinov2Service {
  private readonly logger: Logger = new Logger(Dinov2Service.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly diffWorkerPool: DiffWorkerPool
  ) {}

  async confirmsNoise(
    baseline: Buffer,
    image: Buffer,
    ignoreAreas: IgnoreAreaDto[],
    threshold: number
  ): Promise<Dinov2Verdict> {
    const url = this.configService.get<string>('DINOV2_URL');
    if (!url) {
      this.logger.warn('dinov2Check is on but DINOV2_URL is not set: the run goes to review');
      return { noise: false };
    }
    try {
      const { gate } = await this.diffWorkerPool.run({
        kind: 'patch-gate',
        baseline,
        image,
        ignoreAreas,
        patch: PATCH,
      });
      if (!gate) {
        return { noise: false };
      }
      // nothing but anti-aliasing changed: nothing for the model to look at
      if (gate.cells.length === 0) {
        return { noise: true, score: 0 };
      }

      const response = await fetch(`${url.replace(/\/$/, '')}/v1/patch-distances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseline: baseline.toString('base64'),
          image: image.toString('base64'),
          // only the tiles that hold a marked patch: tiles are encoded
          // independently, so the others would cost time and change nothing
          tiles: tilesOf(gate.cells, gate.width),
        }),
        signal: AbortSignal.timeout(Number(this.configService.get('DINOV2_TIMEOUT_MS')) || DEFAULT_TIMEOUT_MS),
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
      this.logger.warn(
        // read as an Error, not checked with instanceof: fetch errors come
        // from another realm under Jest
        `DINOv2 check failed, the run goes to review: ${(error as Error)?.message ?? error}`
      );
      return { noise: false };
    }
  }
}
