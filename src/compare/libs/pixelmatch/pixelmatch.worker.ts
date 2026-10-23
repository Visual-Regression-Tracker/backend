import { parentPort } from 'worker_threads';
import { runWorkerJob, WorkerJobInput } from './worker-job';

parentPort.on('message', (input: WorkerJobInput) => {
  try {
    parentPort.postMessage(runWorkerJob(input));
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
