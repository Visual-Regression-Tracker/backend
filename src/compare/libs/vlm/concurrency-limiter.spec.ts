import { ConcurrencyLimiter } from './concurrency-limiter';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

const deferred = <T = void>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('ConcurrencyLimiter', () => {
  it('runs at most limit tasks at once', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const gates = Array.from({ length: 5 }, () => deferred<number>());
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const results = gates.map((gate, index) =>
      limiter.run(async () => {
        started.push(index);
        active += 1;
        peak = Math.max(peak, active);
        try {
          return await gate.promise;
        } finally {
          active -= 1;
        }
      })
    );

    await flush();
    expect(started).toEqual([0, 1]);

    gates[0].resolve(10);
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[2].resolve(12);
    gates[1].resolve(11);
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);

    gates[3].resolve(13);
    gates[4].resolve(14);
    await expect(Promise.all(results)).resolves.toEqual([10, 11, 12, 13, 14]);
    expect(peak).toBe(2);
  });

  it('frees the slot when a task rejects', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const first = deferred();
    const failure = new Error('model is down');

    const failing = limiter.run(() => first.promise);
    const next = limiter.run(async () => 'second');
    first.reject(failure);

    await expect(failing).rejects.toBe(failure);
    await expect(next).resolves.toBe('second');
  });

  it('never exceeds the limit when a new task arrives while a waiting one is being woken', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const gates = { a: deferred(), b: deferred(), c: deferred() };
    let active = 0;
    let peak = 0;
    const started: string[] = [];
    const track = (name: keyof typeof gates) =>
      limiter.run(async () => {
        started.push(name);
        active += 1;
        peak = Math.max(peak, active);
        await gates[name].promise;
        active -= 1;
      });

    const a = track('a');
    const b = track('b');
    await flush();
    expect(started).toEqual(['a']);

    gates.a.resolve();
    const c = track('c');
    await flush();
    expect(started).toEqual(['a', 'b']);

    gates.b.resolve();
    await flush();
    expect(started).toEqual(['a', 'b', 'c']);
    gates.c.resolve();

    await Promise.all([a, b, c]);
    expect(peak).toBe(1);
  });

  it('lets a task start at once when a slot is free again', async () => {
    const limiter = new ConcurrencyLimiter(1);

    await limiter.run(async () => 1);

    await expect(limiter.run(async () => 2)).resolves.toBe(2);
  });
});
