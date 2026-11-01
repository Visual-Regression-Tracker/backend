import { Injectable, Logger, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { Worker } from 'worker_threads';
import { availableParallelism } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';
import { nonNegativeNumber } from '../utils/env';
import { assertWithinPixelLimit, readPngDimensions } from '../static/utils';
import {
  runWorkerJob,
  WorkerJobInput,
  WorkerJobInputOf,
  WorkerJobKind,
  WorkerJobOutput,
  WorkerJobResult,
} from './libs/pixelmatch/worker-job';

const WORKER_FILE = join(__dirname, 'libs', 'pixelmatch', 'pixelmatch.worker.js');

const MAX_SPAWN_FAILURES = 3;
const MAX_JOB_CRASHES = 2;

export const QUEUE_FULL_RETRY_AFTER_SECONDS = 5;

export class ImageDiffQueueFullException extends ServiceUnavailableException {
  readonly retryAfterSeconds = QUEUE_FULL_RETRY_AFTER_SECONDS;
  constructor(queueLimit: number) {
    super(`Image diff queue is full (${queueLimit} jobs)`);
  }
}

export class ImageDiffPoolStoppedException extends ServiceUnavailableException {
  readonly retryAfterSeconds = QUEUE_FULL_RETRY_AFTER_SECONDS;
}

export class ImageDiffJobTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Image diff job timed out after ${timeoutMs} ms`);
    this.name = 'ImageDiffJobTimeoutError';
  }
}

const JOB_TIMEOUT_MS = 120_000;
const DEFAULT_WORKER_MAX_HEAP_MB = 512;

interface Job {
  input: WorkerJobInput;
  resolve: (output: WorkerJobOutput) => void;
  reject: (error: Error) => void;
  crashes: number;
  timer?: NodeJS.Timeout;
}

@Injectable()
export class DiffWorkerPool implements OnApplicationShutdown {
  private readonly logger: Logger = new Logger(DiffWorkerPool.name);
  private readonly size = Math.max(
    1,
    Math.min(Number(process.env.DIFF_WORKERS_COUNT) || availableParallelism() - 1, 8)
  );
  private readonly queueLimit = Number(process.env.DIFF_QUEUE_LIMIT) || 256;
  private readonly maxHeapMb = nonNegativeNumber(process.env.DIFF_WORKER_MAX_HEAP_MB, DEFAULT_WORKER_MAX_HEAP_MB);
  private inline = !existsSync(WORKER_FILE);
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private ready = new Set<Worker>();
  private inFlight = new Map<Worker, Job>();
  private started = false;
  private destroyed = false;
  private spawnFailures = 0;

  async run<K extends WorkerJobKind>(input: WorkerJobInputOf<K>): Promise<WorkerJobResult<K>> {
    this.assertWithinPixelLimit(input);
    if (this.inline) {
      return (await runWorkerJob(input)) as WorkerJobResult<K>;
    }
    if (this.destroyed) {
      throw new ImageDiffPoolStoppedException('Image diff worker pool is shut down');
    }
    if (this.queue.length >= this.queueLimit) {
      throw new ImageDiffQueueFullException(this.queueLimit);
    }
    this.start();
    return new Promise<WorkerJobResult<K>>((resolve, reject) => {
      this.queue.push({ input, resolve: resolve as Job['resolve'], reject, crashes: 0 });
      this.dispatch();
    });
  }

  // a 69-byte PNG can claim 30000x30000: check IHDR before decoding
  private assertWithinPixelLimit(input: WorkerJobInput): void {
    const sizes = [input.baseline, input.image].map((bytes) => readPngDimensions(bytes));
    for (const size of sizes) {
      if (size) assertWithinPixelLimit(size.width, size.height);
    }
    const [baseline, image] = sizes;
    if (input.kind === 'diff' && input.allowDiffDimensions && baseline && image) {
      assertWithinPixelLimit(Math.max(baseline.width, image.width), Math.max(baseline.height, image.height));
    }
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    for (let i = 0; i < this.size; i++) {
      this.spawn();
    }
    this.logger.log(`Started ${this.size} image diff workers`);
  }

  private spawn(): void {
    const worker = new Worker(
      WORKER_FILE,
      this.maxHeapMb > 0 ? { resourceLimits: { maxOldGenerationSizeMb: this.maxHeapMb } } : {}
    );
    worker.on('message', (output: WorkerJobOutput & { error?: string }) => {
      if ((output as { ready?: unknown }).ready === true) {
        if (this.workers.includes(worker)) {
          this.ready.add(worker);
          this.spawnFailures = 0;
        }
        return;
      }
      const job = this.inFlight.get(worker);
      this.inFlight.delete(worker);
      clearTimeout(job?.timer);
      if (this.workers.includes(worker)) {
        this.idle.push(worker);
        this.spawnFailures = 0;
      }
      if (job) {
        if (output.error) {
          job.reject(new Error(output.error));
        } else {
          job.resolve(output);
        }
      }
      this.dispatch();
    });
    worker.on('error', (error) => {
      this.logger.error(`Image diff worker crashed: ${error}`);
      this.replace(worker, error);
    });
    worker.on('exit', (code) => this.replace(worker, new Error(`Image diff worker exited with code ${code}`)));
    this.workers.push(worker);
    this.idle.push(worker);
  }

  private replace(worker: Worker, error: Error): void {
    if (!this.workers.includes(worker)) return;
    const loaded = this.ready.has(worker);
    const job = this.forget(worker);
    if (job) {
      if (loaded) job.crashes += 1;
      if (!this.destroyed && job.crashes < MAX_JOB_CRASHES) {
        this.queue.unshift(job);
      } else {
        job.reject(error);
      }
    }
    if (this.destroyed) {
      return;
    }

    if (!loaded) {
      this.spawnFailures += 1;
      if (this.spawnFailures >= MAX_SPAWN_FAILURES) {
        this.inline = true;
        this.logger.error(
          `Image diff workers failed to load ${this.spawnFailures} times, comparing on the main thread from now on`
        );
        this.drainQueueInline();
        return;
      }
    }

    this.spawn();
    this.dispatch();
  }

  private forget(worker: Worker): Job | undefined {
    this.ready.delete(worker);
    this.workers = this.workers.filter((w) => w !== worker);
    this.idle = this.idle.filter((w) => w !== worker);
    const job = this.inFlight.get(worker);
    this.inFlight.delete(worker);
    clearTimeout(job?.timer);
    return job;
  }

  private drainQueueInline(): void {
    const queued = this.queue;
    this.queue = [];
    for (const job of queued) {
      Promise.resolve()
        .then(() => runWorkerJob(job.input))
        .then(job.resolve, (error) => job.reject(error instanceof Error ? error : new Error(String(error))));
    }
  }

  private dispatch(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.inFlight.set(worker, job);
      worker.postMessage(job.input);
      job.timer = setTimeout(() => this.timeOut(worker, job), JOB_TIMEOUT_MS);
      job.timer.unref();
    }
  }

  private timeOut(worker: Worker, job: Job): void {
    if (this.inFlight.get(worker) !== job) return;
    this.forget(worker);
    this.logger.error(`Image diff job ran over ${JOB_TIMEOUT_MS} ms, replacing its worker`);
    job.reject(new ImageDiffJobTimeoutError(JOB_TIMEOUT_MS));
    worker.terminate().catch(() => undefined);
    this.spawn();
    this.dispatch();
  }

  async onApplicationShutdown(): Promise<void> {
    this.destroyed = true;
    const shutdownError = new ImageDiffPoolStoppedException('Image diff worker pool is shutting down');
    for (const job of this.queue) {
      job.reject(shutdownError);
    }
    this.queue = [];
    for (const job of this.inFlight.values()) {
      clearTimeout(job.timer);
      job.reject(shutdownError);
    }
    this.inFlight.clear();
    const workers = this.workers;
    this.workers = [];
    this.idle = [];
    this.ready.clear();
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
