import { parentPort } from 'worker_threads';
import { computePixelmatchDiff, PixelmatchJobInput } from './pixelmatch.core';

parentPort.on('message', (input: PixelmatchJobInput) => {
  try {
    parentPort.postMessage(computePixelmatchDiff(input));
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
