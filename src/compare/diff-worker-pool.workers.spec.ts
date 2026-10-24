import { EventEmitter } from 'events';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { Worker } from 'worker_threads';
import { availableParallelism } from 'os';
import { existsSync } from 'fs';
import { DiffWorkerPool } from './diff-worker-pool';
import { runWorkerJob } from './libs/pixelmatch/worker-job';
import { PixelmatchJobInput } from './libs/pixelmatch/pixelmatch.core';

// The pool only talks to real worker threads once the compiled worker file
// exists (dist). These tests stand in for both: the file "exists", and every
// Worker is an in-process fake the test drives by emitting its events.
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

// settles a promise into a value the test can inspect without an unhandled rejection
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

  const createPool = ({ workers = '1', queueLimit }: { workers?: string; queueLimit?: string } = {}) => {
    process.env.DIFF_WORKERS_COUNT = workers;
    if (queueLimit === undefined) {
      delete process.env.DIFF_QUEUE_LIMIT;
    } else {
      process.env.DIFF_QUEUE_LIMIT = queueLimit;
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
    pool = undefined;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  describe('pool size', () => {
    it.each([
      ['DIFF_WORKERS_COUNT when set', '3', 4, 3],
      ['DIFF_WORKERS_COUNT capped at 8', '20', 4, 8],
      ['cores - 1 when DIFF_WORKERS_COUNT is not a number', 'abc', 4, 3],
      // NOTE: current behavior — an explicit "0" is falsy and treated as unset
      ['cores - 1 when DIFF_WORKERS_COUNT is 0', '0', 6, 5],
      ['cores - 1 capped at 8', '', 32, 8],
      ['at least one worker on a single core', '', 1, 1],
    ])('uses %s', async (_, workers, cores, expected) => {
      availableParallelismMock.mockReturnValue(cores);
      createPool({ workers });

      settle(pool.run(job(1)));

      expect(WorkerMock).toHaveBeenCalledTimes(expected);
    });

    it('spawns no worker until the first job and logs how many it started', async () => {
      createPool({ workers: '2' });

      expect(WorkerMock).not.toHaveBeenCalled();

      settle(pool.run(job(1)));
      settle(pool.run(job(2)));

      expect(WorkerMock).toHaveBeenCalledTimes(2);
      expect(WorkerMock).toHaveBeenCalledWith(join(__dirname, 'libs', 'pixelmatch', 'pixelmatch.worker.js'));
      expect(loggerLogSpy).toHaveBeenCalledWith('Started 2 image diff workers');
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

      settle(pool.run(job(1)));
      settle(pool.run(job(2)));

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
    it('rejects a job once the waiting queue holds DIFF_QUEUE_LIMIT jobs, not counting the ones in flight', async () => {
      createPool({ queueLimit: '1' });

      const inFlight = settle(pool.run(job(1)));
      const queued = settle(pool.run(job(2)));

      await expect(pool.run(job(3))).rejects.toThrow('Image diff queue is full (1 jobs)');
      expect(mockWorkers[0].postMessage).toHaveBeenCalledTimes(1);

      mockWorkers[0].emit('message', output(1));
      mockWorkers[0].emit('message', output(2));
      expect((await inFlight).value).toEqual(output(1));
      expect((await queued).value).toEqual(output(2));
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

    it('keeps a worker that exited with code 0 in the pool', async () => {
      createPool();

      pool.run(job(1));
      mockWorkers[0].emit('message', output(1));
      mockWorkers[0].emit('exit', 0);
      const pending = settle(pool.run(job(2)));

      // NOTE: current behavior — a clean exit is ignored, so the exited worker
      // stays idle and is handed the next job, which would never be answered.
      expect(mockWorkers).toHaveLength(1);
      expect(mockWorkers[0].postMessage).toHaveBeenLastCalledWith(job(2));

      await pool.onApplicationShutdown();
      expect((await pending).error).toEqual(new Error('Image diff worker pool is shutting down'));
    });

    it('gives a job up with the error of the last worker after it was handed out three times', async () => {
      createPool({ workers: '2' });

      const target = settle(pool.run(job(1)));
      const other = pool.run(job(2));
      const [, first] = mockWorkers;
      expect(first.postMessage).toHaveBeenCalledWith(job(1));

      first.emit('error', new Error('first'));
      const second = mockWorkers[2];
      expect(second.postMessage).toHaveBeenCalledWith(job(1));

      // a healthy answer in between resets the consecutive failure count
      mockWorkers[0].emit('message', output(2));
      await expect(other).resolves.toEqual(output(2));

      second.emit('error', new Error('second'));
      const third = mockWorkers[3];
      expect(third.postMessage).toHaveBeenCalledWith(job(1));

      third.emit('error', new Error('third'));

      // NOTE: current behavior — MAX_JOB_ATTEMPTS = 2 reads as "handed to a worker
      // at most twice", but the job runs on three workers before it is rejected.
      expect((await target).error).toEqual(new Error('third'));
      expect(mockWorkers).toHaveLength(5);
      expect(mockWorkers[4].postMessage).not.toHaveBeenCalled();
    });

    it('rejects with the exit code when the last failure was a non-zero exit', async () => {
      createPool({ workers: '2' });

      const target = settle(pool.run(job(1)));
      const other = pool.run(job(2));
      mockWorkers[1].emit('exit', 2);
      mockWorkers[0].emit('message', output(2));
      await other;
      mockWorkers[2].emit('exit', 3);
      mockWorkers[3].emit('exit', 4);

      expect((await target).error).toEqual(new Error('Image diff worker exited with code 4'));
    });

    it('falls back to inline after three consecutive failures and answers the queued jobs on this thread', async () => {
      createPool();
      runWorkerJobMock
        .mockReturnValueOnce(output(2))
        .mockImplementationOnce(() => {
          throw new Error('inline failed');
        })
        .mockImplementationOnce(() => {
          throw 'not an error';
        })
        .mockReturnValueOnce(output(5));

      const inFlight = settle(pool.run(job(1)));
      const queued2 = pool.run(job(2));
      const queued3 = settle(pool.run(job(3)));
      const queued4 = settle(pool.run(job(4)));

      mockWorkers[0].emit('error', new Error('load failed 1'));
      mockWorkers[1].emit('error', new Error('load failed 2'));
      expect(runWorkerJobMock).not.toHaveBeenCalled();
      mockWorkers[2].emit('error', new Error('load failed 3'));

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Image diff workers failed to run 3 times, comparing on the main thread from now on'
      );
      // the job that was on the failing worker is rejected, the waiting ones run inline
      expect((await inFlight).error).toEqual(new Error('load failed 3'));
      await expect(queued2).resolves.toEqual(output(2));
      expect((await queued3).error).toEqual(new Error('inline failed'));
      expect((await queued4).error).toEqual(new Error('not an error'));
      expect(runWorkerJobMock.mock.calls).toEqual([[job(2)], [job(3)], [job(4)]]);
      expect(mockWorkers).toHaveLength(3);

      // and every later job runs inline without spawning anything
      await expect(pool.run(job(5))).resolves.toEqual(output(5));
      expect(runWorkerJobMock).toHaveBeenLastCalledWith(job(5));
      expect(mockWorkers).toHaveLength(3);
    });

    it('ignores a late answer from a worker that was already dropped', async () => {
      createPool();

      const result = pool.run(job(1));
      const dropped = mockWorkers[0];
      dropped.emit('error', new Error('boom'));
      const replacement = mockWorkers[1];

      dropped.emit('message', output(99));
      const next = pool.run(job(2));

      // the late answer neither settles the retried job nor brings the worker back
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

    it('refuses new jobs once shut down', async () => {
      createPool();
      settle(pool.run(job(1)));

      await pool.onApplicationShutdown();

      await expect(pool.run(job(2))).rejects.toThrow('Image diff worker pool is shut down');
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
