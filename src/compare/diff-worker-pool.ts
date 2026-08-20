import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Worker } from 'worker_threads';
import { availableParallelism } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';
import { computePixelmatchDiff, PixelmatchJobInput, PixelmatchJobOutput } from './libs/pixelmatch/pixelmatch.core';

const WORKER_FILE = join(__dirname, 'libs', 'pixelmatch', 'pixelmatch.worker.js');

interface Job {
  input: PixelmatchJobInput;
  resolve: (output: PixelmatchJobOutput) => void;
  reject: (error: Error) => void;
}

/**
 * Fixed pool of worker threads for CPU-bound image diffing. Keeps the event
 * loop free during build ingestion so the API stays responsive while
 * screenshots are compared. Pool size: DIFF_WORKERS_COUNT env var, defaulting
 * to cores - 1 (capped) so the main thread always has a core left.
 */
@Injectable()
export class DiffWorkerPool implements OnModuleDestroy {
  private readonly logger: Logger = new Logger(DiffWorkerPool.name);
  private readonly size = Math.max(
    1,
    Math.min(Number(process.env.DIFF_WORKERS_COUNT) || availableParallelism() - 1, 8)
  );
  // The compiled worker file only exists in the built app (dist). Under
  // ts-jest / ts-node run the job inline instead.
  private readonly inline = !existsSync(WORKER_FILE);
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private inFlight = new Map<Worker, Job>();
  private started = false;
  private destroyed = false;

  async run(input: PixelmatchJobInput): Promise<PixelmatchJobOutput> {
    if (this.inline) {
      return computePixelmatchDiff(input);
    }
    this.start();
    return new Promise<PixelmatchJobOutput>((resolve, reject) => {
      this.queue.push({ input, resolve, reject });
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
    worker.on('message', (output: PixelmatchJobOutput & { error?: string }) => {
      const job = this.inFlight.get(worker);
      this.inFlight.delete(worker);
      this.idle.push(worker);
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
      job.reject(error);
    }
    if (!this.destroyed) {
      this.spawn();
      this.dispatch();
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
    const workers = this.workers;
    this.workers = [];
    this.idle = [];
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
