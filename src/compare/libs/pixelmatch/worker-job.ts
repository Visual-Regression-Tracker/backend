import { computeBlurAmplitude } from './blur-amplitude.core';
import { computeLooksSame } from '../looks-same/looks-same.core';
import { computePixelmatchDiff } from './pixelmatch.core';
import { computeVlmInputs } from '../vlm/vlm-inputs.core';
import { computeChangeSignature } from './signature.core';

const JOBS = {
  diff: computePixelmatchDiff,
  signature: computeChangeSignature,
  'blur-amplitude': computeBlurAmplitude,
  'looks-same': computeLooksSame,
  'vlm-inputs': computeVlmInputs,
} as const;

type Jobs = typeof JOBS;

export type WorkerJobKind = keyof Jobs;
export type WorkerJobInput = { [K in WorkerJobKind]: Parameters<Jobs[K]>[0] }[WorkerJobKind];
export type WorkerJobOutput = { [K in WorkerJobKind]: Awaited<ReturnType<Jobs[K]>> }[WorkerJobKind];

export type WorkerJobResult<K extends WorkerJobKind> = Awaited<ReturnType<Jobs[K]>>;
export type WorkerJobInputOf<K extends WorkerJobKind> = Parameters<Jobs[K]>[0] & { kind: K };

export function runWorkerJob(input: WorkerJobInput): WorkerJobOutput | Promise<WorkerJobOutput> {
  return (JOBS[input.kind] as (input: WorkerJobInput) => WorkerJobOutput | Promise<WorkerJobOutput>)(input);
}
