import { BlurAmplitudeJobInput, BlurAmplitudeJobOutput, computeBlurAmplitude } from './blur-amplitude.core';
import { computePixelmatchDiff, PixelmatchJobInput, PixelmatchJobOutput } from './pixelmatch.core';
import { computeChangeSignature, SignatureJobInput, SignatureJobOutput } from './signature.core';

/**
 * The jobs {@link DiffWorkerPool} runs off the event loop, discriminated by
 * `kind`. Both the worker thread and the pool's inline fallback go through
 * {@link runWorkerJob}, so the two paths cannot answer a job differently.
 */
export type WorkerJobInput = PixelmatchJobInput | SignatureJobInput | BlurAmplitudeJobInput;
export type WorkerJobOutput = PixelmatchJobOutput | SignatureJobOutput | BlurAmplitudeJobOutput;

export function runWorkerJob(input: WorkerJobInput): WorkerJobOutput {
  switch (input.kind) {
    case 'signature':
      return computeChangeSignature(input);
    case 'blur-amplitude':
      return computeBlurAmplitude(input);
    default:
      return computePixelmatchDiff(input);
  }
}
