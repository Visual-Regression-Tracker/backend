import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { strongestPatchDistance, Dinov2Service, tilesOf } from './dinov2.service';

const WIDTH = 32;
const HEIGHT = 20;
const at = (row: number, col: number) => row * WIDTH + col;

const grid = (values: Record<number, number>) => Array.from({ length: WIDTH * HEIGHT }, (_, i) => values[i] ?? 0);

describe('strongestPatchDistance', () => {
  it('scores a single changed patch by its distance', () => {
    expect(strongestPatchDistance(grid({ [at(3, 3)]: 0.9 }), [at(3, 3)])).toBeCloseTo(0.9);
  });

  it('scores several changed patches by the strongest of them', () => {
    expect(strongestPatchDistance(grid({ [at(3, 3)]: 0.4, [at(8, 20)]: 0.7 }), [at(3, 3), at(8, 20)])).toBeCloseTo(0.7);
  });

  it('counts only the patches pixelmatch marked', () => {
    const distances = grid({ [at(3, 3)]: 0.2, [at(3, 4)]: 0.9 });

    expect(strongestPatchDistance(distances, [at(3, 3)])).toBeCloseTo(0.2);
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

  const measure = (service: Dinov2Service, given = gate) =>
    service.patchDistances(given, Buffer.from('baseline'), Buffer.from('image'));

  it('takes the service address with or without a trailing slash, and its own timeout', async () => {
    const { service } = await init({ DINOV2_URL: 'http://dinov2:8000/', DINOV2_TIMEOUT_MS: '5000' });
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(answer({}) as Response);

    await measure(service);

    expect(fetchMock.mock.calls[0][0]).toBe('http://dinov2:8000/v1/patch-distances');
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'X-Timeout-Ms': '5000' });
    timeout.mockRestore();
  });

  it('falls back to its default timeout for a negative DINOV2_TIMEOUT_MS', async () => {
    const { service } = await init({ DINOV2_URL: 'http://dinov2:8000', DINOV2_TIMEOUT_MS: '-1' });
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(answer({}) as Response);

    await measure(service);

    expect(timeout).toHaveBeenCalledWith(60_000);
    timeout.mockRestore();
  });

  it('returns the distances the service measured and sends the baseline, image and tiles', async () => {
    const { service } = await init();
    const distances = grid({ [at(3, 3)]: 0.05, [at(3, 4)]: 0.6 });
    fetchMock.mockResolvedValue(answer({ [at(3, 3)]: 0.05, [at(3, 4)]: 0.6 }) as Response);

    expect(await measure(service)).toEqual({ distances, width: WIDTH, height: HEIGHT });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('http://dinov2:8000/v1/patch-distances');
    expect(request?.method).toBe('POST');
    expect(JSON.parse(request?.body as string)).toEqual({
      baseline: Buffer.from('baseline').toString('base64'),
      image: Buffer.from('image').toString('base64'),
      tiles: [[0, 0]],
    });
  });

  it('measures nothing and sends no request when no patch is marked', async () => {
    const { service } = await init();

    expect(await measure(service, { ...gate, cells: [] })).toEqual({ distances: [], width: WIDTH, height: HEIGHT });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for a gate it cannot read', async () => {
    const { service } = await init();

    expect(await measure(service, { width: WIDTH, height: HEIGHT } as typeof gate)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null without a service configured', async () => {
    const { service } = await init({ DINOV2_URL: '' });

    expect(await measure(service)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['http://dinov2:8000', true],
    ['', false],
  ])('with DINOV2_URL %p is configured: %p', async (url, configured) => {
    const { service } = await init({ DINOV2_URL: url });

    expect(service.isConfigured()).toBe(configured);
  });

  it('returns null when the answer does not fit the screenshots', async () => {
    const { service } = await init();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ patch: 14, width: 3, height: 3, distances: [0, 0, 0, 0, 0, 0, 0, 0, 0] }),
    } as Response);

    expect(await measure(service)).toBeNull();
  });

  it.each([
    ['without a distances list', { width: WIDTH, height: HEIGHT }],
    ['with distances that are not a list', { width: WIDTH, height: HEIGHT, distances: 'none' }],
    ['with a distance list of the wrong length', { width: WIDTH, height: HEIGHT, distances: [0, 0] }],
  ])('returns null for an answer %s', async (_, body) => {
    const { service } = await init();
    fetchMock.mockResolvedValue({ ok: true, json: async () => body } as Response);

    expect(await measure(service)).toBeNull();
  });

  it.each([413, 500, 503])('returns null when the service answers %p', async (status) => {
    const { service } = await init();
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({}) } as Response);

    expect(await measure(service)).toBeNull();
  });

  it.each([
    ['is unreachable', new TypeError('fetch failed')],
    ['times out', new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
    ['fails with something that is not an Error', 'socket hang up'],
  ])('returns null once, without a retry, when the service %s', async (_, failure) => {
    const { service } = await init();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    fetchMock.mockRejectedValue(failure);

    expect(await measure(service)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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
