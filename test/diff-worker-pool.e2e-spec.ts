import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist', 'compare');

type PoolModule = typeof import('../src/compare/diff-worker-pool');
type JobModule = typeof import('../src/compare/libs/pixelmatch/worker-job');

describe('DiffWorkerPool on real worker threads (compiled build)', () => {
  const baseline = readFileSync(join(__dirname, 'image.png'));
  const image = readFileSync(join(__dirname, 'image_edited.png'));
  const workersCount = process.env.DIFF_WORKERS_COUNT;
  let pool: InstanceType<PoolModule['DiffWorkerPool']>;
  let runWorkerJob: JobModule['runWorkerJob'];

  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
    const { DiffWorkerPool } = require(join(DIST, 'diff-worker-pool.js')) as PoolModule;
    ({ runWorkerJob } = require(join(DIST, 'libs', 'pixelmatch', 'worker-job.js')) as JobModule);
    process.env.DIFF_WORKERS_COUNT = '2';
    pool = new DiffWorkerPool();
  }, 120000);

  afterAll(async () => {
    await pool?.onApplicationShutdown();
    if (workersCount === undefined) delete process.env.DIFF_WORKERS_COUNT;
    else process.env.DIFF_WORKERS_COUNT = workersCount;
  });

  const internals = () => pool as unknown as { inline: boolean; workers: unknown[] };

  it('finds the worker file where the build puts it', () => {
    expect(existsSync(join(DIST, 'libs', 'pixelmatch', 'pixelmatch.worker.js'))).toBe(true);
    expect(internals().inline).toBe(false);
  });

  it.each([
    [
      'diff',
      {
        kind: 'diff',
        ignoreAreas: [],
        threshold: 0.1,
        includeAA: false,
        diffTolerancePercent: 0,
        saveDiff: true,
      },
    ],
    ['signature', { kind: 'signature', ignoreAreas: [], threshold: 0.1, includeAA: false }],
    ['blur-amplitude', { kind: 'blur-amplitude', ignoreAreas: [], gateIfNoise: { threshold: 80 } }],
    [
      'looks-same',
      {
        kind: 'looks-same',
        ignoreAreas: [],
        config: { strict: false, ignoreAntialiasing: true, ignoreCaret: true, allowDiffDimensions: false },
        saveDiff: true,
      },
    ],
    ['vlm-inputs', { kind: 'vlm-inputs', ignoreAreas: [] }],
  ])('runs a %s job in a worker with the same result as inline', async (_kind, params) => {
    const input = { ...params, baseline, image } as Parameters<JobModule['runWorkerJob']>[0];

    const output = await pool.run(input);

    expect(internals().workers.length).toBeGreaterThan(0);
    expect(output).toEqual(await runWorkerJob(input));
  });
});
