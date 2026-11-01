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
  let postedOnLoad: unknown[][];

  beforeAll(() => {
    require('./pixelmatch.worker');
    postedOnLoad = [...port.postMessage.mock.calls];
  });

  beforeEach(() => {
    port.postMessage.mockClear();
    runWorkerJobMock.mockReset();
  });

  it('announces that it has loaded', () => {
    expect(postedOnLoad).toEqual([[{ ready: true }]]);
  });

  it('listens for jobs on the parent port', () => {
    expect(port.listenerCount('message')).toBe(1);
  });

  const flush = () => new Promise(setImmediate);

  it('runs the job it receives and posts the result back', async () => {
    runWorkerJobMock.mockReturnValue({ signature: [1] });

    port.emit('message', input);
    await flush();

    expect(runWorkerJobMock).toHaveBeenCalledWith(input);
    expect(port.postMessage).toHaveBeenCalledWith({ signature: [1] });
  });

  it('posts the error message back when the job throws an Error', async () => {
    runWorkerJobMock.mockImplementation(() => {
      throw new Error('Invalid PNG');
    });

    port.emit('message', input);
    await flush();

    expect(port.postMessage).toHaveBeenCalledWith({ error: 'Invalid PNG' });
  });

  it('posts the stringified value back when the job throws something that is not an Error', () => {
    runWorkerJobMock.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- worker must stringify non-Error throws
      throw 42;
    });

    port.emit('message', input);

    expect(port.postMessage).toHaveBeenCalledWith({ error: '42' });
  });

  it('awaits an async job before posting its result', async () => {
    runWorkerJobMock.mockResolvedValue({ outcome: 'equal' });

    port.emit('message', input);
    await flush();

    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith({ outcome: 'equal' });
  });

  it('posts the message of an async job that rejects', async () => {
    runWorkerJobMock.mockRejectedValue(new Error('boom'));

    port.emit('message', input);
    await flush();

    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith({ error: 'boom' });
  });
});
