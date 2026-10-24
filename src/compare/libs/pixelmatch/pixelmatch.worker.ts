import { parentPort } from 'worker_threads';
import { runWorkerJob, WorkerJobInput } from './worker-job';

// this file is only ever loaded as a worker thread, where parentPort is set
const port = parentPort!;

port.on('message', (input: WorkerJobInput) => {
  try {
    port.postMessage(runWorkerJob(input));
  } catch (error) {
    port.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
