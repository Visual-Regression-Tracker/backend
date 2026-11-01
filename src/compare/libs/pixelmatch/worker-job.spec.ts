import { computeLooksSame, LooksSameJobInput } from '../looks-same/looks-same.core';
import { computeVlmInputs, VlmInputsJobInput } from '../vlm/vlm-inputs.core';
import { runWorkerJob } from './worker-job';

jest.mock('../looks-same/looks-same.core', () => ({
  computeLooksSame: jest.fn(),
}));
jest.mock('../vlm/vlm-inputs.core', () => ({
  computeVlmInputs: jest.fn(),
}));

describe('runWorkerJob', () => {
  it('hands a looks-same job to computeLooksSame and returns its promise', async () => {
    const input: LooksSameJobInput = {
      kind: 'looks-same',
      baseline: Buffer.from('baseline'),
      image: Buffer.from('image'),
      ignoreAreas: [],
      config: {},
      saveDiff: false,
    };
    (computeLooksSame as jest.Mock).mockResolvedValue({ outcome: 'equal' });

    await expect(runWorkerJob(input)).resolves.toEqual({ outcome: 'equal' });
    expect(computeLooksSame).toHaveBeenCalledWith(input);
  });

  it('hands a vlm-inputs job to computeVlmInputs', () => {
    const input: VlmInputsJobInput = {
      kind: 'vlm-inputs',
      baseline: Buffer.from('baseline'),
      image: Buffer.from('image'),
      ignoreAreas: [],
    };
    const output = { baseline: null, image: null };
    (computeVlmInputs as jest.Mock).mockReturnValue(output);

    expect(runWorkerJob(input)).toBe(output);
    expect(computeVlmInputs).toHaveBeenCalledWith(input);
  });
});
