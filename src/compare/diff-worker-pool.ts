import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Worker } from 'worker_threads';
import { availableParallelism } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';
import { PixelmatchJobInput, PixelmatchJobOutput } from './libs/pixelmatch/pixelmatch.core';
import { SignatureJobInput, SignatureJobOutput } from './libs/pixelmatch/signature.core';
import { runWorkerJob, WorkerJobInput, WorkerJobOutput } from './libs/pixelmatch/worker-job';

const WORKER_FILE = join(__dirname, 'libs', 'pixelmatch', 'pixelmatch.worker.js');

// consecutive worker failures after which the pool stops respawning
const MAX_SPAWN_FAILURES = 3;
// how many times a job may be handed to a worker before it is given up on
const MAX_JOB_ATTEMPTS = 2;

interface Job {
  input: WorkerJobInput;
  resolve: (output: WorkerJobOutput) => void;
  reject: (error: Error) => void;
  attempts: number;
}

/**
 * Fixed pool of worker threads for CPU-bound image work — diffing a screenshot
 * against its baseline, and the change signatures the variations dialog
 * compares. Keeps the event loop free so the API stays responsive while
 * screenshots are decoded and compared. Pool size: DIFF_WORKERS_COUNT env var,
 * defaulting to cores - 1 (capped) so the main thread always has a core left.
 */
@Injectable()
export class DiffWorkerPool implements OnModuleDestroy {
  private readonly logger: Logger = new Logger(DiffWorkerPool.name);
  private readonly size = Math.max(
    1,
    Math.min(Number(process.env.DIFF_WORKERS_COUNT) || availableParallelism() - 1, 8)
  );
  // Queued jobs hold both full image buffers, so an unbounded queue could
  // exhaust memory under a flood of concurrent uploads.
  private readonly queueLimit = Number(process.env.DIFF_QUEUE_LIMIT) || 256;
  // The compiled worker file only exists in the built app (dist). Under
  // ts-jest / ts-node run the job inline instead.
  private inline = !existsSync(WORKER_FILE);
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private inFlight = new Map<Worker, Job>();
  private started = false;
  private destroyed = false;
  private spawnFailures = 0;

  async run(input: PixelmatchJobInput): Promise<PixelmatchJobOutput>;
  async run(input: SignatureJobInput): Promise<SignatureJobOutput>;
  async run(input: WorkerJobInput): Promise<WorkerJobOutput> {
    if (this.inline) {
      return runWorkerJob(input);
    }
    if (this.destroyed) {
      throw new Error('Image diff worker pool is shut down');
    }
    if (this.queue.length >= this.queueLimit) {
      throw new Error(`Image diff queue is full (${this.queueLimit} jobs)`);
    }
    this.start();
    return new Promise<WorkerJobOutput>((resolve, reject) => {
      this.queue.push({ input, resolve, reject, attempts: 0 });
      this.dispatch();
    });
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
    const worker = new Worker(WORKER_FILE);
    worker.on('message', (output: WorkerJobOutput & { error?: string }) => {
      const job = this.inFlight.get(worker);
      this.inFlight.delete(worker);
      // a message can arrive after the worker was dropped or the pool shut
      // down; taking it back would hand it a job it will never answer
      if (this.workers.includes(worker)) {
        this.idle.push(worker);
        this.spawnFailures = 0;
      }
      if (job) {
        output.error ? job.reject(new Error(output.error)) : job.resolve(output);
      }
      this.dispatch();
    });
    worker.on('error', (error) => {
      this.logger.error(`Image diff worker crashed: ${error}`);
      this.replace(worker, error);
    });
    worker.on('exit', (code) => {
      if (code !== 0) {
        this.replace(worker, new Error(`Image diff worker exited with code ${code}`));
      }
    });
    this.workers.push(worker);
    this.idle.push(worker);
  }

  private replace(worker: Worker, error: Error): void {
    if (!this.workers.includes(worker)) return;
    this.workers = this.workers.filter((w) => w !== worker);
    this.idle = this.idle.filter((w) => w !== worker);
    const job = this.inFlight.get(worker);
    this.inFlight.delete(worker);
    if (job) {
      // a worker dying takes its job down with it; give the job one more run
      // rather than failing the upload waiting behind it
      if (!this.destroyed && job.attempts < MAX_JOB_ATTEMPTS) {
        job.attempts += 1;
        this.queue.unshift(job);
      } else {
        job.reject(error);
      }
    }
    if (this.destroyed) {
      return;
    }

    // a worker script that fails to load fails the same way every time, so
    // respawning on each error would spin. Fall back to comparing on this
    // thread instead: slower, but the uploads still go through.
    this.spawnFailures += 1;
    if (this.spawnFailures >= MAX_SPAWN_FAILURES) {
      this.inline = true;
      this.logger.error(
        `Image diff workers failed to run ${this.spawnFailures} times, comparing on the main thread from now on`
      );
      this.drainQueueInline();
      return;
    }

    this.spawn();
    this.dispatch();
  }

  // the pool gave up on workers: answer what is already queued here
  private drainQueueInline(): void {
    const queued = this.queue;
    this.queue = [];
    for (const job of queued) {
      try {
        job.resolve(runWorkerJob(job.input));
      } catch (error) {
        job.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private dispatch(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop();
      const job = this.queue.shift();
      this.inFlight.set(worker, job);
      worker.postMessage(job.input);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    const shutdownError = new Error('Image diff worker pool is shutting down');
    for (const job of this.queue) {
      job.reject(shutdownError);
    }
    this.queue = [];
    for (const job of this.inFlight.values()) {
      job.reject(shutdownError);
    }
    this.inFlight.clear();
    const workers = this.workers;
    this.workers = [];
    this.idle = [];
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
