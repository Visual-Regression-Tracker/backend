import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { blobScore, Dinov2Service, tilesOf } from './dinov2.service';

const WIDTH = 32;
const HEIGHT = 20;
const at = (row: number, col: number) => row * WIDTH + col;

const grid = (values: Record<number, number>) => Array.from({ length: WIDTH * HEIGHT }, (_, i) => values[i] ?? 0);

describe('blobScore', () => {
  it('ignores a single changed patch', () => {
    const cells = [at(3, 3)];

    expect(blobScore(grid({ [at(3, 3)]: 0.9 }), WIDTH, HEIGHT, cells)).toBe(0);
  });

  it('scores two neighbouring changed patches by the weaker of them', () => {
    const cells = [at(3, 3), at(3, 4)];

    expect(blobScore(grid({ [at(3, 3)]: 0.9, [at(3, 4)]: 0.4 }), WIDTH, HEIGHT, cells)).toBeCloseTo(0.4);
  });

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

  const init = async (env: Record<string, string> = { DINOV2_URL: 'http://dinov2:8000' }) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [Dinov2Service, { provide: ConfigService, useValue: { get: (key: string) => env[key] } }],
    }).compile();
    return { service: module.get(Dinov2Service) };
  };

  const fetchMock = jest.spyOn(global, 'fetch');
  afterEach(() => fetchMock.mockReset());

  const confirm = (service: Dinov2Service, given = gate) =>
    service.confirmsNoiseForGate(given, Buffer.from('baseline'), Buffer.from('image'), 0.15);

  it('takes the service address with or without a trailing slash, and its own timeout', async () => {
    const { service } = await init({ DINOV2_URL: 'http://dinov2:8000/', DINOV2_TIMEOUT_MS: '5000' });
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(answer({}) as Response);

    await confirm(service);

    expect(fetchMock.mock.calls[0][0]).toBe('http://dinov2:8000/v1/patch-distances');
    expect(timeout).toHaveBeenCalledWith(5000);
    timeout.mockRestore();
  });

  it('falls back to its default timeout for a negative DINOV2_TIMEOUT_MS', async () => {
    const { service } = await init({ DINOV2_URL: 'http://dinov2:8000', DINOV2_TIMEOUT_MS: '-1' });
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(answer({}) as Response);

    await confirm(service);

    expect(timeout).toHaveBeenCalledWith(60_000);
    timeout.mockRestore();
  });

  it('confirms noise when the content did not change', async () => {
    const { service } = await init();
    fetchMock.mockResolvedValue(answer({ [at(3, 3)]: 0.05, [at(3, 4)]: 0.04 }) as Response);

    expect(await confirm(service)).toEqual({ noise: true, score: 0.04 });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('http://dinov2:8000/v1/patch-distances');
    expect(JSON.parse(request?.body as string)).toEqual({
      baseline: Buffer.from('baseline').toString('base64'),
      image: Buffer.from('image').toString('base64'),
      tiles: [[0, 0]],
    });
  });

  it('sees a change in content', async () => {
    const { service } = await init();
    fetchMock.mockResolvedValue(answer({ [at(3, 3)]: 0.6, [at(3, 4)]: 0.5 }) as Response);

    expect(await confirm(service)).toEqual({ noise: false, score: 0.5 });
  });

  it('confirms noise without a call when no patch is marked', async () => {
    const { service } = await init();

    expect(await confirm(service, { ...gate, cells: [] })).toEqual({ noise: true, score: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not confirm noise without a service configured', async () => {
    const { service } = await init({ DINOV2_URL: '' });

    expect((await confirm(service)).noise).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not confirm noise when the answer does not fit the screenshots', async () => {
    const { service } = await init();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ patch: 14, width: 3, height: 3, distances: [0, 0, 0, 0, 0, 0, 0, 0, 0] }),
    } as Response);

    expect((await confirm(service)).noise).toBe(false);
  });

  it('does not confirm noise when the service fails or is unreachable', async () => {
    const { service } = await init();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as Response);
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    fetchMock.mockRejectedValueOnce('socket hang up');

    expect((await confirm(service)).noise).toBe(false);
    expect((await confirm(service)).noise).toBe(false);
    expect((await confirm(service)).noise).toBe(false);
  });

  describe('status', () => {
    const status = async (url: string) => (await init({ DINOV2_URL: url })).service.status();

    it('is not configured without a service address', async () => {
      expect(await status('')).toEqual({ configured: false, available: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("is available when the service's health check answers", async () => {
      fetchMock.mockResolvedValue({ ok: true } as Response);

      expect(await status('http://dinov2:8000/')).toEqual({ configured: true, available: true });
      expect(fetchMock.mock.calls[0][0]).toBe('http://dinov2:8000/health');
    });

    it('is configured but not available when the health check fails', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);

      expect(await status('http://dinov2:8000')).toEqual({ configured: true, available: false });
    });

    it.each([
      ['the service is unreachable', new TypeError('fetch failed')],
      ['the check throws something that is not an Error', 'socket hang up'],
    ])('is configured but not available when %s', async (_, failure) => {
      fetchMock.mockRejectedValue(failure);

      expect(await status('http://dinov2:8000')).toEqual({ configured: true, available: false });
    });
  });
});
