import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DiffWorkerPool } from '../../diff-worker-pool';
import { blobScore, Dinov2Service, tilesOf } from './dinov2.service';

// a 32 x 20 patch grid: two tile columns, two tile rows (16 x 16 patches each)
const WIDTH = 32;
const HEIGHT = 20;
const at = (row: number, col: number) => row * WIDTH + col;

const grid = (values: Record<number, number>) => Array.from({ length: WIDTH * HEIGHT }, (_, i) => values[i] ?? 0);

describe('blobScore', () => {
  // a lone patch is how noise looks: one changed patch, nothing beside it
  it('ignores a single changed patch', () => {
    const cells = [at(3, 3)];

    expect(blobScore(grid({ [at(3, 3)]: 0.9 }), WIDTH, HEIGHT, cells)).toBe(0);
  });

  it('scores two neighbouring changed patches by the weaker of them', () => {
    const cells = [at(3, 3), at(3, 4)];

    expect(blobScore(grid({ [at(3, 3)]: 0.9, [at(3, 4)]: 0.4 }), WIDTH, HEIGHT, cells)).toBeCloseTo(0.4);
  });

  // only where pixelmatch saw a change: elsewhere the distance is context
  // bleeding across a tile, not a change
  it('counts only the patches pixelmatch marked', () => {
    const distances = grid({ [at(3, 3)]: 0.9, [at(3, 4)]: 0.9 });

    expect(blobScore(distances, WIDTH, HEIGHT, [at(3, 3)])).toBe(0);
  });

  it('counts a pair on the edge of the grid', () => {
    const cells = [at(HEIGHT - 1, 0), at(HEIGHT - 1, 1)];

    expect(blobScore(grid({ [cells[0]]: 0.3, [cells[1]]: 0.7 }), WIDTH, HEIGHT, cells)).toBeCloseTo(0.3);
  });

  it('does not join patches across a row end', () => {
    const cells = [at(3, WIDTH - 1), at(4, 0)];

    expect(blobScore(grid({ [cells[0]]: 0.9, [cells[1]]: 0.9 }), WIDTH, HEIGHT, cells)).toBe(0);
  });
});

describe('tilesOf', () => {
  it('orders tiles by row, then column', () => {
    expect(tilesOf([at(17, 0), at(0, 20), at(0, 1)], WIDTH)).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });

  it('names each 224 px tile holding a marked patch once', () => {
    expect(tilesOf([at(0, 0), at(1, 1), at(17, 20)], WIDTH)).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe('Dinov2Service', () => {
  const gate = { width: WIDTH, height: HEIGHT, cells: [at(3, 3), at(3, 4)] };
  const answer = (values: Record<number, number>) => ({
    ok: true,
    json: async () => ({ patch: 14, width: WIDTH, height: HEIGHT, distances: grid(values) }),
  });

  const init = async ({ url = 'http://dinov2:8000', poolOutput = { gate } as object } = {}) => {
    const run = jest.fn().mockResolvedValue(poolOutput);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Dinov2Service,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(url) } },
        { provide: DiffWorkerPool, useValue: { run } },
      ],
    }).compile();
    return { service: module.get(Dinov2Service), run };
  };

  const fetchMock = jest.spyOn(global, 'fetch');
  afterEach(() => fetchMock.mockReset());

  const confirm = (service: Dinov2Service) =>
    service.confirmsNoise(Buffer.from('baseline'), Buffer.from('image'), [{ x: 1, y: 2, width: 3, height: 4 }], 0.15);

  it('confirms noise when the content did not change', async () => {
    const { service, run } = await init();
    fetchMock.mockResolvedValue(answer({ [at(3, 3)]: 0.05, [at(3, 4)]: 0.04 }) as Response);

    expect(await confirm(service)).toEqual({ noise: true, score: 0.04 });
    expect(run).toHaveBeenCalledWith({
      kind: 'patch-gate',
      baseline: Buffer.from('baseline'),
      image: Buffer.from('image'),
      ignoreAreas: [{ x: 1, y: 2, width: 3, height: 4 }],
      patch: 14,
    });
  });

  it('sees a change in content', async () => {
    const { service } = await init();
    fetchMock.mockResolvedValue(answer({ [at(3, 3)]: 0.6, [at(3, 4)]: 0.5 }) as Response);

    expect(await confirm(service)).toEqual({ noise: false, score: 0.5 });
  });

  // only the tiles holding a marked patch are encoded: identical result,
  // a fraction of the time
  it('asks the service for the marked tiles only', async () => {
    const { service } = await init();
    fetchMock.mockResolvedValue(answer({}) as Response);

    await confirm(service);

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('http://dinov2:8000/v1/patch-distances');
    expect(JSON.parse(request?.body as string)).toEqual({
      baseline: Buffer.from('baseline').toString('base64'),
      image: Buffer.from('image').toString('base64'),
      tiles: [[0, 0]],
    });
  });

  it('takes the service address with or without a trailing slash, and its own timeout', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Dinov2Service,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => ({ DINOV2_URL: 'http://dinov2:8000/', DINOV2_TIMEOUT_MS: '5000' })[key] },
        },
        { provide: DiffWorkerPool, useValue: { run: jest.fn().mockResolvedValue({ gate }) } },
      ],
    }).compile();
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(answer({}) as Response);

    await confirm(module.get(Dinov2Service));

    expect(fetchMock.mock.calls[0][0]).toBe('http://dinov2:8000/v1/patch-distances');
    expect(timeout).toHaveBeenCalledWith(5000);
    timeout.mockRestore();
  });

  // nothing but anti-aliasing changed: nothing for DINOv2 to look at
  it('confirms noise without a call when pixelmatch marked no patch', async () => {
    const { service } = await init({ poolOutput: { gate: { ...gate, cells: [] } } });

    expect(await confirm(service)).toEqual({ noise: true, score: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // the check exists to stop the blur passing a real change; when it cannot
  // check, the run goes to review rather than through
  describe('when it cannot check', () => {
    it('does not confirm noise without a service configured', async () => {
      // an unset variable reads as empty
      const { service } = await init({ url: '' });

      expect((await confirm(service)).noise).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not confirm noise when the service fails', async () => {
      const { service } = await init();
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);

      expect((await confirm(service)).noise).toBe(false);
    });

    it('does not confirm noise when the check throws something that is not an Error', async () => {
      const { service } = await init();
      fetchMock.mockRejectedValue('socket hang up');

      expect((await confirm(service)).noise).toBe(false);
    });

    it('does not confirm noise when the service is unreachable', async () => {
      const { service } = await init();
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      expect((await confirm(service)).noise).toBe(false);
    });

    it('does not confirm noise when the answer does not fit the screenshots', async () => {
      const { service } = await init();
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ patch: 14, width: 3, height: 3, distances: [0, 0, 0, 0, 0, 0, 0, 0, 0] }),
      } as Response);

      expect((await confirm(service)).noise).toBe(false);
    });

    it('does not confirm noise when the screenshots cannot be lined up', async () => {
      const { service } = await init({ poolOutput: { gate: null } });

      expect((await confirm(service)).noise).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
