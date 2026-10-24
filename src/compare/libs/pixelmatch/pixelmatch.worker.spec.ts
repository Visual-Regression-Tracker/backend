import { EventEmitter } from 'events';
import { parentPort } from 'worker_threads';
import { runWorkerJob } from './worker-job';
import { SignatureJobInput } from './signature.core';

jest.mock('worker_threads', () => {
  const { EventEmitter: Emitter } = jest.requireActual('events');
  const port = new Emitter();
  port.postMessage = jest.fn();
  return { parentPort: port };
});

jest.mock('./worker-job', () => ({
  runWorkerJob: jest.fn(),
}));

const port = parentPort as unknown as EventEmitter & { postMessage: jest.Mock };
const runWorkerJobMock = runWorkerJob as jest.Mock;

const input: SignatureJobInput = {
  kind: 'signature',
  baseline: Buffer.from('baseline'),
  image: Buffer.from('image'),
  ignoreAreas: [],
  threshold: 0.1,
  includeAA: false,
};

describe('pixelmatch.worker', () => {
  beforeAll(() => {
    // a plain require: under `module: nodenext` an import() stays a real ESM import
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./pixelmatch.worker');
  });

  beforeEach(() => {
    port.postMessage.mockClear();
    runWorkerJobMock.mockReset();
  });

  it('listens for jobs on the parent port', () => {
    expect(port.listenerCount('message')).toBe(1);
  });

  it('runs the job it receives and posts the result back', () => {
    runWorkerJobMock.mockReturnValue({ signature: [1] });

    port.emit('message', input);

    expect(runWorkerJobMock).toHaveBeenCalledWith(input);
    expect(port.postMessage).toHaveBeenCalledWith({ signature: [1] });
  });

  it('posts the error message back when the job throws an Error', () => {
    runWorkerJobMock.mockImplementation(() => {
      throw new Error('Invalid PNG');
    });

    port.emit('message', input);

    expect(port.postMessage).toHaveBeenCalledWith({ error: 'Invalid PNG' });
  });

  it('posts the stringified value back when the job throws something that is not an Error', () => {
    runWorkerJobMock.mockImplementation(() => {
      throw 42;
    });

    port.emit('message', input);

    expect(port.postMessage).toHaveBeenCalledWith({ error: '42' });
  });
});
