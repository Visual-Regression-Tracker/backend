import { parentPort } from 'worker_threads';
import { runWorkerJob, WorkerJobInput } from './worker-job';

const port = parentPort!;

// eslint-disable-next-line @typescript-eslint/no-misused-promises -- handler reports errors via postMessage
port.on('message', async (input: WorkerJobInput) => {
  try {
    port.postMessage(await runWorkerJob(input));
  } catch (error) {
    port.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});

port.postMessage({ ready: true });
