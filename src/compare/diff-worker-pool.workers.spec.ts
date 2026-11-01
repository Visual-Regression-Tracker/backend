import { EventEmitter } from 'events';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { Worker } from 'worker_threads';
import { availableParallelism } from 'os';
import { existsSync } from 'fs';
import {
  DiffWorkerPool,
  ImageDiffJobTimeoutError,
  ImageDiffPoolStoppedException,
  ImageDiffQueueFullException,
} from './diff-worker-pool';
import { PNG } from 'pngjs';
import { ImageTooLargeException } from '../static/utils';
import { runWorkerJob } from './libs/pixelmatch/worker-job';
import { PixelmatchJobInput } from './libs/pixelmatch/pixelmatch.core';

class FakeWorker extends EventEmitter {
  postMessage = jest.fn();
  terminate = jest.fn().mockResolvedValue(0);
  constructor(readonly file: string) {
    super();
  }
}

const mockWorkers: FakeWorker[] = [];

jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation((file: string) => {
    const worker = new FakeWorker(file);
    mockWorkers.push(worker);
    return worker;
  }),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
}));

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  availableParallelism: jest.fn(),
}));

jest.mock('./libs/pixelmatch/worker-job', () => ({
  runWorkerJob: jest.fn(),
}));

const WorkerMock = Worker as unknown as jest.Mock;
const existsSyncMock = existsSync as jest.Mock;
const availableParallelismMock = availableParallelism as jest.Mock;
const runWorkerJobMock = runWorkerJob as jest.Mock;

const job = (id: number): PixelmatchJobInput => ({
  kind: 'diff',
  baseline: Buffer.from(`baseline-${id}`),
  image: Buffer.from(`image-${id}`),
  ignoreAreas: [],
  threshold: 0.1,
  includeAA: false,
  allowDiffDimensions: false,
  diffTolerancePercent: 0,
  saveDiff: false,
});

const output = (pixelMisMatchCount: number) => ({
  equal: false,
  isSameDimension: true,
  pixelMisMatchCount,
  diffPercent: pixelMisMatchCount,
});

const ready = (worker: FakeWorker) => worker.emit('message', { ready: true });

const settle = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value, error: undefined as Error | undefined }),
    (error: Error) => ({ value: undefined as T | undefined, error })
  );

describe('DiffWorkerPool with worker threads', () => {
  const originalEnv = { ...process.env };
  let pool: DiffWorkerPool;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  const createPool = ({
    workers = '1',
    queueLimit,
    jobTimeout,
    maxHeap,
  }: { workers?: string; queueLimit?: string; jobTimeout?: string; maxHeap?: string } = {}) => {
    const env = {
      DIFF_WORKER_MAX_HEAP_MB: maxHeap,
      DIFF_WORKERS_COUNT: workers,
      DIFF_JOB_TIMEOUT_MS: jobTimeout,
      DIFF_QUEUE_LIMIT: queueLimit,
    };
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    pool = new DiffWorkerPool();
    return pool;
  };

  beforeEach(() => {
    mockWorkers.length = 0;
    WorkerMock.mockClear();
    existsSyncMock.mockReset().mockReturnValue(true);
    availableParallelismMock.mockReset().mockReturnValue(4);
    runWorkerJobMock.mockReset();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(async () => {
    await pool?.onApplicationShutdown();
    pool = undefined as unknown as DiffWorkerPool;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  describe('pool size', () => {
    it.each([
      ['DIFF_WORKERS_COUNT when set', '3', 4, 3],
      ['DIFF_WORKERS_COUNT capped at 8', '20', 4, 8],
      ['cores - 1 when DIFF_WORKERS_COUNT is not a number', 'abc', 4, 3],
      ['cores - 1 when DIFF_WORKERS_COUNT is 0 (no workers is not an option)', '0', 6, 5],
      ['cores - 1 capped at 8', '', 32, 8],
      ['at least one worker on a single core', '', 1, 1],
    ])('uses %s', async (_, workers, cores, expected) => {
      availableParallelismMock.mockReturnValue(cores);
      createPool({ workers });

      void settle(pool.run(job(1)));

      expect(WorkerMock).toHaveBeenCalledTimes(expected);
    });

    it('spawns no worker until the first job and logs how many it started', async () => {
      createPool({ workers: '2' });

      expect(WorkerMock).not.toHaveBeenCalled();

      void settle(pool.run(job(1)));
      void settle(pool.run(job(2)));

      expect(WorkerMock).toHaveBeenCalledTimes(2);
      expect(WorkerMock).toHaveBeenCalledWith(join(__dirname, 'libs', 'pixelmatch', 'pixelmatch.worker.js'), {
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      });
      expect(loggerLogSpy).toHaveBeenCalledWith('Started 2 image diff workers');
    });
  });

  describe('worker heap limit', () => {
    it.each([
      ['takes the limit from DIFF_WORKER_MAX_HEAP_MB', '256', { resourceLimits: { maxOldGenerationSizeMb: 256 } }],
      ['drops the limit for 0', '0', {}],
      ['falls back to 512 for garbage', 'lots', { resourceLimits: { maxOldGenerationSizeMb: 512 } }],
    ])('%s', async (_, maxHeap, options) => {
      createPool({ maxHeap });

      void settle(pool.run(job(1)));

      expect(WorkerMock).toHaveBeenCalledWith(expect.any(String), options);
    });
  });

  describe('inline mode', () => {
    it('runs the job on the calling thread when the compiled worker file is missing', async () => {
      existsSyncMock.mockReturnValue(false);
      runWorkerJobMock.mockReturnValue(output(5));
      createPool();

      await expect(pool.run(job(1))).resolves.toEqual(output(5));

      expect(existsSyncMock).toHaveBeenCalledWith(join(__dirname, 'libs', 'pixelmatch', 'pixelmatch.worker.js'));
      expect(runWorkerJobMock).toHaveBeenCalledWith(job(1));
      expect(WorkerMock).not.toHaveBeenCalled();
    });
  });

  describe('dispatch', () => {
    it('posts the job to an idle worker and resolves with its answer', async () => {
      createPool();

      const result = pool.run(job(1));

      expect(mockWorkers[0].postMessage).toHaveBeenCalledWith(job(1));
      mockWorkers[0].emit('message', output(7));
      await expect(result).resolves.toEqual(output(7));
      expect(runWorkerJobMock).not.toHaveBeenCalled();
    });

    it('hands the first job to the most recently spawned idle worker', async () => {
      createPool({ workers: '2' });

      void settle(pool.run(job(1)));
      void settle(pool.run(job(2)));

      expect(mockWorkers[1].postMessage).toHaveBeenCalledWith(job(1));
      expect(mockWorkers[0].postMessage).toHaveBeenCalledWith(job(2));
    });

    it('queues jobs while every worker is busy and dispatches them in order as workers free up', async () => {
      createPool();

      const first = pool.run(job(1));
      const second = pool.run(job(2));
      const third = pool.run(job(3));

      const [worker] = mockWorkers;
      expect(worker.postMessage).toHaveBeenCalledTimes(1);

      worker.emit('message', output(1));
      expect(worker.postMessage).toHaveBeenCalledTimes(2);
      expect(worker.postMessage).toHaveBeenLastCalledWith(job(2));

      worker.emit('message', output(2));
      expect(worker.postMessage).toHaveBeenLastCalledWith(job(3));

      worker.emit('message', output(3));
      await expect(Promise.all([first, second, third])).resolves.toEqual([output(1), output(2), output(3)]);
    });

    it('rejects the job when the worker answers with an error and keeps the worker in use', async () => {
      createPool();

      const failing = pool.run(job(1));
      const next = pool.run(job(2));
      const [worker] = mockWorkers;

      worker.emit('message', { error: 'Image decode failed' });

      await expect(failing).rejects.toThrow(new Error('Image decode failed'));
      expect(worker.postMessage).toHaveBeenLastCalledWith(job(2));
      worker.emit('message', output(2));
      await expect(next).resolves.toEqual(output(2));
    });
  });

  describe('queue limit', () => {
    it('rejects a job once the waiting queue holds DIFF_QUEUE_LIMIT jobs, not counting the ones in flight, with 503 and a retry hint', async () => {
      createPool({ queueLimit: '1' });

      const inFlight = settle(pool.run(job(1)));
      const queued = settle(pool.run(job(2)));

      const { error } = await settle(pool.run(job(3)));
      expect(error).toBeInstanceOf(ImageDiffQueueFullException);
      expect((error as ImageDiffQueueFullException).getStatus()).toBe(503);
      expect((error as ImageDiffQueueFullException).retryAfterSeconds).toBe(5);
      expect(error?.message).toBe('Image diff queue is full (1 jobs)');
      expect(mockWorkers[0].postMessage).toHaveBeenCalledTimes(1);

      mockWorkers[0].emit('message', output(1));
      mockWorkers[0].emit('message', output(2));
      expect((await inFlight).value).toEqual(output(1));
      expect((await queued).value).toEqual(output(2));
    });

    it('does not queue an oversized job', async () => {
      process.env.MAX_IMAGE_PIXELS = '50';
      createPool();
      const big = PNG.sync.write(new PNG({ width: 10, height: 10 }));

      await expect(pool.run({ ...job(1), baseline: big, image: big })).rejects.toBeInstanceOf(ImageTooLargeException);

      expect(WorkerMock).not.toHaveBeenCalled();
      expect(runWorkerJobMock).not.toHaveBeenCalled();
    });

    it('defaults to a queue of 256 waiting jobs', async () => {
      createPool();

      const pending = Array.from({ length: 257 }, (_, i) => settle(pool.run(job(i))));

      await expect(pool.run(job(999))).rejects.toThrow('Image diff queue is full (256 jobs)');

      await pool.onApplicationShutdown();
      expect((await Promise.all(pending)).every(({ error }) => error?.message.includes('shutting down'))).toBe(true);
    });
  });

  describe('worker failures', () => {
    it('replaces a crashed worker and runs its job again on the new one', async () => {
      createPool();

      const result = pool.run(job(1));
      const crashed = mockWorkers[0];
      crashed.emit('error', new Error('boom'));

      expect(loggerErrorSpy).toHaveBeenCalledWith('Image diff worker crashed: Error: boom');
      expect(mockWorkers).toHaveLength(2);
      expect(mockWorkers[1].postMessage).toHaveBeenCalledWith(job(1));

      mockWorkers[1].emit('message', output(3));
      await expect(result).resolves.toEqual(output(3));
    });

    it('treats a non-zero exit like a crash', async () => {
      createPool();

      const result = pool.run(job(1));
      mockWorkers[0].emit('exit', 1);

      expect(mockWorkers).toHaveLength(2);
      expect(mockWorkers[1].postMessage).toHaveBeenCalledWith(job(1));
      mockWorkers[1].emit('message', output(1));
      await expect(result).resolves.toEqual(output(1));
    });

    it('counts an error followed by the exit of the same worker as one failure', async () => {
      createPool();

      const result = pool.run(job(1));
      mockWorkers[0].emit('error', new Error('boom'));
      mockWorkers[0].emit('exit', 1);

      expect(mockWorkers).toHaveLength(2);
      mockWorkers[1].emit('message', output(1));
      await expect(result).resolves.toEqual(output(1));
    });

    it('replaces a worker that exited with code 0', async () => {
      createPool();

      const first = pool.run(job(1));
      ready(mockWorkers[0]);
      mockWorkers[0].emit('message', output(1));
      await expect(first).resolves.toEqual(output(1));
      mockWorkers[0].emit('exit', 0);
      const second = pool.run(job(2));

      expect(mockWorkers).toHaveLength(2);
      expect(mockWorkers[1].postMessage).toHaveBeenCalledWith(job(2));
      expect(mockWorkers[0].postMessage).toHaveBeenCalledTimes(1);
      mockWorkers[1].emit('message', output(2));
      await expect(second).resolves.toEqual(output(2));
    });

    it('runs a job at most twice on loaded workers', async () => {
      createPool({ workers: '2' });

      const target = settle(pool.run(job(1)));
      const other = pool.run(job(2));
      const [first0, first] = mockWorkers;
      ready(first0);
      ready(first);
      expect(first.postMessage).toHaveBeenCalledWith(job(1));

      first.emit('error', new Error('first'));
      const second = mockWorkers[2];
      ready(second);
      expect(second.postMessage).toHaveBeenCalledWith(job(1));

      first0.emit('message', output(2));
      await expect(other).resolves.toEqual(output(2));

      second.emit('error', new Error('second'));

      expect((await target).error).toEqual(new Error('second'));
      expect(mockWorkers).toHaveLength(4);
      expect(mockWorkers[3].postMessage).not.toHaveBeenCalled();
    });

    it('does not switch to inline mode when a job keeps crashing loaded workers', async () => {
      createPool();

      const poison = settle(pool.run(job(1)));
      ready(mockWorkers[0]);
      mockWorkers[0].emit('error', new Error('oom 1'));
      ready(mockWorkers[1]);
      mockWorkers[1].emit('error', new Error('oom 2'));

      expect((await poison).error).toEqual(new Error('oom 2'));

      const next = settle(pool.run(job(2)));
      expect(runWorkerJobMock).not.toHaveBeenCalled();
      expect(mockWorkers[2].postMessage).toHaveBeenCalledWith(job(2));
      ready(mockWorkers[2]);
      mockWorkers[2].emit('message', output(2));
      expect((await next).value).toEqual(output(2));
    });

    it('does not count a load failure against the job', async () => {
      createPool();

      const result = pool.run(job(1));
      mockWorkers[0].emit('error', new Error('cannot load'));

      expect(mockWorkers[1].postMessage).toHaveBeenCalledWith(job(1));
      ready(mockWorkers[1]);
      mockWorkers[1].emit('message', output(1));
      await expect(result).resolves.toEqual(output(1));
    });

    it('resets the load-failure count once a worker has loaded', async () => {
      createPool();

      void settle(pool.run(job(1)));
      mockWorkers[0].emit('error', new Error('load 1'));
      mockWorkers[1].emit('error', new Error('load 2'));
      ready(mockWorkers[2]);
      mockWorkers[2].emit('message', output(1));
      mockWorkers[2].emit('error', new Error('idle crash'));
      mockWorkers[3].emit('error', new Error('load 3'));
      mockWorkers[4].emit('error', new Error('load 4'));

      expect(runWorkerJobMock).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('comparing on the main thread'));
    });

    it('ignores a ready message from a dropped worker', async () => {
      createPool();

      void settle(pool.run(job(1)));
      const dropped = mockWorkers[0];
      dropped.emit('error', new Error('load 1'));
      dropped.emit('message', { ready: true });
      mockWorkers[1].emit('error', new Error('load 2'));
      dropped.emit('message', { ready: true });
      mockWorkers[2].emit('error', new Error('load 3'));

      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('comparing on the main thread'));
    });

    it('rejects with the exit code when the last failure was a non-zero exit', async () => {
      createPool({ workers: '2' });

      const target = settle(pool.run(job(1)));
      const other = pool.run(job(2));
      ready(mockWorkers[0]);
      ready(mockWorkers[1]);
      mockWorkers[1].emit('exit', 2);
      mockWorkers[0].emit('message', output(2));
      await other;
      ready(mockWorkers[2]);
      mockWorkers[2].emit('exit', 3);

      expect((await target).error).toEqual(new Error('Image diff worker exited with code 3'));
      expect(mockWorkers[3].postMessage).not.toHaveBeenCalled();
    });

    it('falls back to inline after three workers fail to load and answers every job on this thread', async () => {
      createPool();
      runWorkerJobMock
        .mockReturnValueOnce(output(1))
        .mockReturnValueOnce(output(2))
        .mockImplementationOnce(() => {
          throw new Error('inline failed');
        })
        .mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- pool must survive non-Error throws
          throw 'not an error';
        })
        .mockReturnValueOnce(output(5));

      const inFlight = pool.run(job(1));
      const queued2 = pool.run(job(2));
      const queued3 = settle(pool.run(job(3)));
      const queued4 = settle(pool.run(job(4)));

      mockWorkers[0].emit('error', new Error('load failed 1'));
      mockWorkers[1].emit('error', new Error('load failed 2'));
      expect(runWorkerJobMock).not.toHaveBeenCalled();
      mockWorkers[2].emit('error', new Error('load failed 3'));

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Image diff workers failed to load 3 times, comparing on the main thread from now on'
      );
      await expect(inFlight).resolves.toEqual(output(1));
      await expect(queued2).resolves.toEqual(output(2));
      expect((await queued3).error).toEqual(new Error('inline failed'));
      expect((await queued4).error).toEqual(new Error('not an error'));
      expect(runWorkerJobMock.mock.calls).toEqual([[job(1)], [job(2)], [job(3)], [job(4)]]);
      expect(mockWorkers).toHaveLength(3);

      await expect(pool.run(job(5))).resolves.toEqual(output(5));
      expect(runWorkerJobMock).toHaveBeenLastCalledWith(job(5));
      expect(mockWorkers).toHaveLength(3);
    });

    it('answers jobs that finish asynchronously once it runs inline', async () => {
      createPool();
      runWorkerJobMock
        .mockReturnValueOnce(Promise.reject(new Error('async failed')))
        .mockReturnValueOnce(Promise.resolve(output(9)))
        .mockReturnValueOnce(Promise.reject('not an error'));

      const failing = settle(pool.run(job(1)));
      const succeeding = pool.run(job(2));
      const rejectingNonError = settle(pool.run(job(3)));

      mockWorkers[0].emit('error', new Error('load failed 1'));
      mockWorkers[1].emit('error', new Error('load failed 2'));
      mockWorkers[2].emit('error', new Error('load failed 3'));

      expect((await failing).error).toEqual(new Error('async failed'));
      await expect(succeeding).resolves.toEqual(output(9));
      expect((await rejectingNonError).error).toEqual(new Error('not an error'));
    });

    it('does not run a job again when the worker that already answered it crashes later', async () => {
      createPool();

      const result = pool.run(job(1));
      mockWorkers[0].emit('message', output(1));
      await expect(result).resolves.toEqual(output(1));

      mockWorkers[0].emit('error', new Error('boom'));

      expect(mockWorkers).toHaveLength(2);
      expect(mockWorkers[1].postMessage).not.toHaveBeenCalled();
    });

    it('takes only the crashed worker out of the idle ones', async () => {
      createPool({ workers: '3' });

      void settle(pool.run(job(1)));
      const [crashed, idle, busy] = mockWorkers;
      expect(busy.postMessage).toHaveBeenCalledWith(job(1));

      crashed.emit('error', new Error('boom'));
      const replacement = mockWorkers[3];
      void settle(pool.run(job(2)));
      void settle(pool.run(job(3)));
      void settle(pool.run(job(4)));

      expect(replacement.postMessage).toHaveBeenCalledWith(job(2));
      expect(idle.postMessage).toHaveBeenCalledWith(job(3));
      expect(crashed.postMessage).not.toHaveBeenCalled();
    });

    it('ignores a late answer from a worker that was already dropped', async () => {
      createPool();

      const result = pool.run(job(1));
      const dropped = mockWorkers[0];
      dropped.emit('error', new Error('boom'));
      const replacement = mockWorkers[1];

      dropped.emit('message', output(99));
      const next = pool.run(job(2));

      expect(dropped.postMessage).toHaveBeenCalledTimes(1);
      expect(replacement.postMessage).toHaveBeenCalledTimes(1);

      replacement.emit('message', output(1));
      await expect(result).resolves.toEqual(output(1));
      expect(replacement.postMessage).toHaveBeenLastCalledWith(job(2));
      replacement.emit('message', output(2));
      await expect(next).resolves.toEqual(output(2));
      expect(dropped.postMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('job timeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('rejects a job that runs longer than DIFF_JOB_TIMEOUT_MS and replaces its worker', async () => {
      createPool({ jobTimeout: '1000' });

      const hung = settle(pool.run(job(1)));
      ready(mockWorkers[0]);
      jest.advanceTimersByTime(1000);

      expect((await hung).error).toBeInstanceOf(ImageDiffJobTimeoutError);
      expect((await hung).error?.message).toBe('Image diff job timed out after 1000 ms');
      expect(mockWorkers[0].terminate).toHaveBeenCalledTimes(1);
      expect(mockWorkers).toHaveLength(2);
      expect(loggerErrorSpy).toHaveBeenCalledWith('Image diff job ran over 1000 ms, replacing its worker');

      void settle(pool.run(job(2)));
      expect(mockWorkers[1].postMessage).toHaveBeenCalledWith(job(2));
    });

    it('does not time out a job answered in time', async () => {
      createPool({ jobTimeout: '1000' });

      const result = pool.run(job(1));
      ready(mockWorkers[0]);
      jest.advanceTimersByTime(999);
      mockWorkers[0].emit('message', output(1));
      jest.advanceTimersByTime(5000);

      await expect(result).resolves.toEqual(output(1));
      expect(mockWorkers[0].terminate).not.toHaveBeenCalled();
      expect(mockWorkers).toHaveLength(1);
    });

    it('defaults to 120 s', async () => {
      createPool();

      const result = settle(pool.run(job(1)));
      jest.advanceTimersByTime(119_999);
      expect(mockWorkers[0].terminate).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);

      expect((await result).error).toBeInstanceOf(ImageDiffJobTimeoutError);
    });

    it.each([
      ['turns off with 0', '0'],
      ['falls back to the default for garbage', 'abc'],
      ['falls back to the default for a negative number', '-5'],
      ['falls back to the default for an empty value', ''],
    ])('%s', async (title, jobTimeout) => {
      createPool({ jobTimeout });

      const result = settle(pool.run(job(1)));
      jest.advanceTimersByTime(600_000);

      if (jobTimeout === '0') {
        expect(mockWorkers[0].terminate).not.toHaveBeenCalled();
        mockWorkers[0].emit('message', output(1));
        expect((await result).value).toEqual(output(1));
      } else {
        expect((await result).error).toBeInstanceOf(ImageDiffJobTimeoutError);
        expect((await result).error?.message).toBe('Image diff job timed out after 120000 ms');
      }
    });

    it('ignores the exit of the worker it terminated', async () => {
      createPool({ jobTimeout: '1000' });

      const hung = settle(pool.run(job(1)));
      jest.advanceTimersByTime(1000);
      await hung;
      mockWorkers[0].emit('exit', 1);
      mockWorkers[0].emit('error', new Error('terminated'));

      expect(mockWorkers).toHaveLength(2);
    });

    it('does not retry the timed-out job and does not count it as a load failure', async () => {
      createPool({ jobTimeout: '1000' });

      for (const id of [1, 2, 3]) {
        const hung = settle(pool.run(job(id)));
        jest.advanceTimersByTime(1000);
        expect((await hung).error).toBeInstanceOf(ImageDiffJobTimeoutError);
      }

      expect(runWorkerJobMock).not.toHaveBeenCalled();
      expect(mockWorkers).toHaveLength(4);
      expect(mockWorkers.map((worker) => worker.postMessage.mock.calls.length)).toEqual([1, 1, 1, 0]);
    });

    it('does not spawn a replacement for a pool that is shut down while the job runs', async () => {
      createPool({ jobTimeout: '1000' });

      const pending = settle(pool.run(job(1)));
      await pool.onApplicationShutdown();
      jest.advanceTimersByTime(5000);

      expect((await pending).error).toBeInstanceOf(ImageDiffPoolStoppedException);
      expect(mockWorkers).toHaveLength(1);
      expect(mockWorkers[0].terminate).toHaveBeenCalledTimes(1);
    });
  });

  describe('onApplicationShutdown', () => {
    it('rejects queued and in-flight jobs and terminates every worker', async () => {
      createPool({ workers: '2' });

      const jobs = [1, 2, 3, 4].map((id) => settle(pool.run(job(id))));

      await pool.onApplicationShutdown();

      const shutdownError = new Error('Image diff worker pool is shutting down');
      expect((await Promise.all(jobs)).map(({ error }) => error)).toEqual([
        shutdownError,
        shutdownError,
        shutdownError,
        shutdownError,
      ]);
      expect(mockWorkers.map((worker) => worker.terminate.mock.calls.length)).toEqual([1, 1]);
    });

    it('rejects with 503 once shut down', async () => {
      createPool();
      const queued = [1, 2].map((id) => settle(pool.run(job(id))));

      await pool.onApplicationShutdown();

      for (const { error } of await Promise.all(queued)) {
        expect(error).toBeInstanceOf(ImageDiffPoolStoppedException);
      }
      const { error } = await settle(pool.run(job(3)));
      expect(error).toBeInstanceOf(ImageDiffPoolStoppedException);
      expect(error?.message).toBe('Image diff worker pool is shut down');
      expect((error as ImageDiffPoolStoppedException).getStatus()).toBe(503);
      expect((error as ImageDiffPoolStoppedException).retryAfterSeconds).toBe(5);
      expect(mockWorkers).toHaveLength(1);
    });

    it('does not spawn or dispatch when a terminated worker reports an error, an exit or a late answer', async () => {
      createPool();
      const pending = settle(pool.run(job(1)));

      await pool.onApplicationShutdown();
      const [worker] = mockWorkers;
      worker.emit('error', new Error('terminated'));
      worker.emit('exit', 1);
      worker.emit('message', output(1));

      expect(mockWorkers).toHaveLength(1);
      expect(worker.postMessage).toHaveBeenCalledTimes(1);
      expect((await pending).error).toEqual(new Error('Image diff worker pool is shutting down'));
    });

    it('resolves without terminating anything when no worker was ever started', async () => {
      createPool();

      await expect(pool.onApplicationShutdown()).resolves.toBeUndefined();
      expect(WorkerMock).not.toHaveBeenCalled();
    });
  });
});
