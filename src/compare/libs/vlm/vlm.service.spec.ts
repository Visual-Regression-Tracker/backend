import { Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { StaticService } from '../../../static/static.service';
import { NO_BASELINE_RESULT, EQUAL_RESULT } from '../consts';
import { DEFAULT_CONFIG, VlmService } from './vlm.service';
import { OllamaService } from './providers/ollama/ollama.service';
import { GeminiService } from './providers/gemini/gemini.service';
import { PixelmatchService } from '../pixelmatch/pixelmatch.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { ImageCompareInput } from '../ImageCompareInput';
import { VlmConfig } from './vlm.types';
import { DiffWorkerPool } from '../../diff-worker-pool';
import { pngBytes, solidPng } from '../../test-utils';

const pngBuffer = (width: number, height: number): Buffer => PNG.sync.write(new PNG({ width, height }));
const sequence = (...results: unknown[]) => results.reduce<jest.Mock>((m, r) => m.mockResolvedValueOnce(r), jest.fn());
const reply = (identical: boolean, description: string) => ({ content: JSON.stringify({ identical, description }) });
const modelSaying = (identical: boolean, description = 'ok') =>
  jest.fn().mockResolvedValue(reply(identical, description));

const createPixelmatchResult = (overrides: Partial<DiffResult> = {}): DiffResult => ({
  status: TestStatus.unresolved,
  diffName: 'diff.png',
  pixelMisMatchCount: 100,
  diffPercent: 2.5,
  isSameDimension: true,
  ...overrides,
});

interface Deps {
  pixelmatch?: DiffResult;
  buffers?: unknown[];
  getImageBuffer?: jest.Mock;
  ollama?: jest.Mock;
  gemini?: jest.Mock;
}

const setup = async ({
  pixelmatch = createPixelmatchResult(),
  buffers = [pngBuffer(20, 20), pngBuffer(20, 20), pngBuffer(20, 20)],
  getImageBuffer = sequence(...buffers),
  ollama = jest.fn(),
  gemini = jest.fn(),
}: Deps = {}) => {
  const pixelmatchGetDiff = jest.fn().mockResolvedValue(pixelmatch);
  const module = await Test.createTestingModule({
    providers: [
      VlmService,
      { provide: StaticService, useValue: { getImageBuffer } },
      { provide: OllamaService, useValue: { generate: ollama } },
      { provide: GeminiService, useValue: { generate: gemini } },
      { provide: PixelmatchService, useValue: { getDiff: pixelmatchGetDiff } },
      DiffWorkerPool,
    ],
  }).compile();
  return { service: module.get(VlmService), pixelmatchGetDiff, getImageBuffer, ollama, gemini };
};

const input: ImageCompareInput = {
  baseline: 'baseline',
  image: 'image',
  diffTollerancePercent: 0.1,
  ignoreAreas: [],
  saveDiffAsFile: true,
};

const geminiConfig = {
  provider: 'gemini' as const,
  model: 'gemini-1.5-pro',
  prompt: DEFAULT_CONFIG.prompt,
  temperature: 0.1,
  apiKey: 'test-api-key',
};

const threeImages = expect.arrayContaining([expect.any(Uint8Array), expect.any(Uint8Array), expect.any(Uint8Array)]);

describe('VlmService', () => {
  it('should return OK immediately when pixelmatch finds no differences (VLM not called)', async () => {
    const { service, ollama } = await setup({
      pixelmatch: { ...EQUAL_RESULT, status: TestStatus.ok, pixelMisMatchCount: 0, diffPercent: 0 },
    });

    const result = await service.getDiff(input, DEFAULT_CONFIG);

    expect(result.status).toBe(TestStatus.ok);
    expect(result.pixelMisMatchCount).toBe(0);
    expect(result.diffPercent).toBe(0);
    expect(ollama).not.toHaveBeenCalled();
  });

  it('applies the rendering-noise filter through pixelmatch, before the model', async () => {
    const blurAmplitude = { threshold: 80 };
    const { service, pixelmatchGetDiff, ollama } = await setup({
      pixelmatch: createPixelmatchResult({ status: TestStatus.ok, diffName: null }),
    });

    const result = await service.getDiff({ ...input, diffTollerancePercent: 0, blurAmplitude }, DEFAULT_CONFIG);

    expect(service.appliesBlurAmplitudeFilter).toBe(true);
    expect(pixelmatchGetDiff).toHaveBeenCalledWith(expect.objectContaining({ blurAmplitude }), expect.anything());
    expect(result.status).toBe(TestStatus.ok);
    expect(ollama).not.toHaveBeenCalled();
  });

  it.each([
    [
      'override to OK when VLM says not noticeable',
      reply(true, 'Differences are minor rendering artifacts, not noticeable to humans.'),
      TestStatus.ok,
      { pixelMisMatchCount: 100, diffPercent: 2.5 },
    ],
    [
      'keep unresolved when VLM confirms noticeable',
      reply(false, 'Button text changed from Submit to Send, and user count changed from 12 to 15.'),
      TestStatus.unresolved,
      { pixelMisMatchCount: 500, diffPercent: 12.5 },
    ],
  ])('should %s', async (_, vlmResponse, expectedStatus, pixelmatchOverrides) => {
    const { service, ollama } = await setup({
      pixelmatch: createPixelmatchResult(pixelmatchOverrides),
      ollama: jest.fn().mockResolvedValue(vlmResponse),
    });

    const result = await service.getDiff(input, DEFAULT_CONFIG);

    expect(result.status).toBe(expectedStatus);
    expect(result.vlmDescription).toBe(JSON.parse(vlmResponse.content).description);
    expect(result.pixelMisMatchCount).toBe(pixelmatchOverrides.pixelMisMatchCount);
    expect(result.diffPercent).toBe(pixelmatchOverrides.diffPercent);
    expect(ollama).toHaveBeenCalledWith(DEFAULT_CONFIG, threeImages);
  });

  it('sends the image it is given to the model without reading it again', async () => {
    const image = pngBuffer(20, 20);
    const { service, getImageBuffer, ollama } = await setup({
      buffers: [image, pngBuffer(20, 20)],
      ollama: modelSaying(true),
    });

    await service.getDiff({ ...input, imageBuffer: image }, DEFAULT_CONFIG);

    expect(getImageBuffer.mock.calls).toEqual([['baseline'], ['diff.png']]);
    expect(ollama).toHaveBeenCalled();
  });

  it.each([
    ['invalid JSON response', jest.fn().mockResolvedValue({ content: 'Invalid JSON response from model' }), 200, 5],
    ['API error', jest.fn().mockRejectedValue(new Error('Connection refused')), 300, 7.5],
  ])('should handle %s gracefully and return pixelmatch result', async (_, ollama, pixelMisMatchCount, diffPercent) => {
    const { service } = await setup({
      pixelmatch: createPixelmatchResult({ pixelMisMatchCount, diffPercent }),
      ollama,
    });

    const result = await service.getDiff(input, DEFAULT_CONFIG);

    expect(result.status).toBe(TestStatus.unresolved);
    expect(result.vlmDescription).toContain('VLM analysis failed');
    expect(result.pixelMisMatchCount).toBe(pixelMisMatchCount);
    expect(result.diffPercent).toBe(diffPercent);
  });

  it.each([
    ['ollama', DEFAULT_CONFIG],
    ['gemini', geminiConfig],
  ])('should send baseline and image with ignore areas masked to %s', async (_, config) => {
    const generate = modelSaying(false, 'Changed.');
    const { service } = await setup({
      buffers: [pngBytes(solidPng(20, 20)), pngBytes(solidPng(20, 20, [255, 0, 0])), pngBuffer(20, 20)],
      ollama: generate,
      gemini: generate,
    });

    await service.getDiff({ ...input, ignoreAreas: [{ x: 2, y: 3, width: 5, height: 4 }] }, config);

    expect(generate).toHaveBeenCalledTimes(1);
    const [sentBaseline, sentImage] = (generate.mock.calls[0][1] as Uint8Array[]).map((bytes) =>
      PNG.sync.read(Buffer.from(bytes))
    );
    const pixelAt = (png: PNG, x: number, y: number) =>
      Array.from(png.data.subarray(4 * (png.width * y + x), 4 * (png.width * y + x) + 4));
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const isIgnored = x >= 2 && x < 7 && y >= 3 && y < 7;
        expect(pixelAt(sentBaseline, x, y)).toEqual(isIgnored ? [0, 0, 0, 0] : [255, 255, 255, 255]);
        expect(pixelAt(sentImage, x, y)).toEqual(isIgnored ? [0, 0, 0, 0] : [255, 0, 0, 255]);
      }
    }
  });

  it('should use custom model and temperature from config', async () => {
    const { service, ollama } = await setup({ ollama: modelSaying(true, 'No differences.') });
    const customConfig = { ...DEFAULT_CONFIG, model: 'llava:13b', prompt: 'Custom context', temperature: 0.2 };

    await service.getDiff(input, customConfig);

    expect(ollama).toHaveBeenCalledWith(customConfig, threeImages);
  });

  it('should use thinking field when useThinking is true', async () => {
    const { service } = await setup({
      ollama: jest.fn().mockResolvedValue({
        content: JSON.stringify({ identical: false, description: 'Content field' }),
        thinking: JSON.stringify({ identical: true, description: 'Thinking field' }),
      }),
    });

    const result = await service.getDiff(input, { ...DEFAULT_CONFIG, useThinking: true });

    expect(result.status).toBe(TestStatus.ok);
    expect(result.vlmDescription).toBe('Thinking field');
  });

  it('should handle missing diff image gracefully', async () => {
    const pixelmatch = createPixelmatchResult({ diffName: null });
    const image = pngBuffer(20, 20);
    const { service, ollama } = await setup({ pixelmatch, buffers: [image, image, null] });

    expect(await service.getDiff(input, DEFAULT_CONFIG)).toEqual(pixelmatch);
    expect(ollama).not.toHaveBeenCalled();
  });

  it.each([
    ['empty string', '', DEFAULT_CONFIG],
    ['invalid JSON', 'invalid', DEFAULT_CONFIG],
    ['partial config, over the defaults', '{"model":"llava:7b"}', { ...DEFAULT_CONFIG, model: 'llava:7b' }],
    [
      'the pixelmatch column default, over the defaults',
      '{ "threshold": 0.1, "ignoreAntialiasing": true, "allowDiffDimensions": false }',
      { ...DEFAULT_CONFIG, threshold: 0.1, ignoreAntialiasing: true, allowDiffDimensions: false },
    ],
    [
      'full config',
      '{"model":"llava:13b","prompt":"Custom prompt","temperature":0.2,"useThinking":true}',
      { provider: 'ollama', model: 'llava:13b', prompt: 'Custom prompt', temperature: 0.2, useThinking: true },
    ],
  ])('should parse config: %s', async (_, configJson, expected) => {
    const { service } = await setup();

    expect(service.parseConfig(configJson)).toEqual(expected);
  });

  describe('characterization', () => {
    it('asks pixelmatch for a saved diff with the pixelmatch defaults when the diff is saved', async () => {
      const { service, pixelmatchGetDiff } = await setup({ pixelmatch: EQUAL_RESULT });

      await service.getDiff(input, { ...DEFAULT_CONFIG, temperature: 0.9 });

      expect(pixelmatchGetDiff).toHaveBeenCalledWith(input, { threshold: 0.1, ignoreAntialiasing: true });
    });

    it.each([
      ['a pixelmatch result with status new', createPixelmatchResult({ status: TestStatus.new }), input],
      ['the no-baseline result', NO_BASELINE_RESULT, { ...input, baseline: null }],
    ])('returns %s without loading images or asking the model', async (_, pixelmatch, data) => {
      const { service, getImageBuffer, ollama, pixelmatchGetDiff } = await setup({
        pixelmatch,
        getImageBuffer: jest.fn(),
      });

      const result = await service.getDiff(data, DEFAULT_CONFIG);

      expect(result).toBe(pixelmatch);
      expect(pixelmatchGetDiff).toHaveBeenCalled();
      expect(getImageBuffer).not.toHaveBeenCalled();
      expect(ollama).not.toHaveBeenCalled();
    });

    describe('auto-approve probe (saveDiffAsFile: false)', () => {
      const probe: ImageCompareInput = { ...input, saveDiffAsFile: false };

      it('answers an auto-approve probe with the pixelmatch verdict, saving nothing and asking no model', async () => {
        const pixelmatch = createPixelmatchResult({ status: TestStatus.unresolved });
        const { service, pixelmatchGetDiff, getImageBuffer, ollama, gemini } = await setup({
          pixelmatch,
          getImageBuffer: jest.fn(),
        });

        const result = await service.getDiff(probe, DEFAULT_CONFIG);

        expect(result).toStrictEqual(pixelmatch);
        expect(pixelmatchGetDiff).toHaveBeenCalledWith(
          expect.objectContaining({ saveDiffAsFile: false }),
          expect.anything()
        );
        expect(ollama).not.toHaveBeenCalled();
        expect(gemini).not.toHaveBeenCalled();
        expect(getImageBuffer).not.toHaveBeenCalled();
      });

      it('passes an ok probe through', async () => {
        const pixelmatch = createPixelmatchResult({ status: TestStatus.ok, diffName: null });
        const { service, ollama } = await setup({ pixelmatch });

        expect(await service.getDiff(probe, DEFAULT_CONFIG)).toStrictEqual(pixelmatch);
        expect(ollama).not.toHaveBeenCalled();
      });
    });

    it('reports an empty model response as a failed analysis', async () => {
      const pixelmatch = createPixelmatchResult();
      const { service } = await setup({
        pixelmatch,
        ollama: jest.fn().mockResolvedValue({ content: '', thinking: undefined }),
      });

      expect(await service.getDiff(input, DEFAULT_CONFIG)).toStrictEqual({
        ...pixelmatch,
        vlmDescription: 'VLM analysis failed: Empty response from model',
      });
    });

    it.each([
      [
        'the thinking field when the content is empty',
        { content: '', thinking: JSON.stringify({ identical: true, description: 'From thinking' }) },
        DEFAULT_CONFIG,
        TestStatus.ok,
        'From thinking',
      ],
      [
        'the content field when thinking is preferred but empty',
        reply(false, 'From content'),
        { ...DEFAULT_CONFIG, useThinking: true },
        TestStatus.unresolved,
        'From content',
      ],
    ])('falls back to %s', async (_, response, config, status, description) => {
      const { service } = await setup({ ollama: jest.fn().mockResolvedValue(response) });

      const result = await service.getDiff(input, config);

      expect(result.status).toBe(status);
      expect(result.vlmDescription).toBe(description);
    });

    it('marks the run unresolved when the model sees a difference, whatever status pixelmatch gave', async () => {
      const { service } = await setup({
        pixelmatch: createPixelmatchResult({ status: TestStatus.failed }),
        ollama: modelSaying(false, 'Button moved'),
      });

      const result = await service.getDiff(input, DEFAULT_CONFIG);

      expect(result.status).toBe(TestStatus.unresolved);
      expect(result.vlmDescription).toBe('Button moved');
    });

    it('fills in a description when the model returns an empty one', async () => {
      const { service } = await setup({ ollama: modelSaying(true, '') });

      const result = await service.getDiff(input, DEFAULT_CONFIG);

      expect(result.vlmDescription).toBe('No description provided');
    });

    it('reports a response that does not match the schema as a failed analysis', async () => {
      const { service } = await setup({ ollama: jest.fn().mockResolvedValue({ content: '{"identical": "yes"}' }) });

      const result = await service.getDiff(input, DEFAULT_CONFIG);

      expect(result.status).toBe(TestStatus.unresolved);
      expect(result.vlmDescription).toMatch(/^VLM analysis failed: /);
    });

    it.each([
      ['no provider', undefined],
      ['an unknown provider', 'openai'],
    ])('uses Ollama when the config names %s', async (_, provider) => {
      const { service, ollama, gemini } = await setup({ ollama: modelSaying(true) });
      const config = { ...DEFAULT_CONFIG, provider } as unknown as VlmConfig;

      await service.getDiff(input, config);

      expect(ollama).toHaveBeenCalledWith(config, expect.any(Array));
      expect(gemini).not.toHaveBeenCalled();
    });

    it('sends baseline, image and diff to the model as PNG bytes in that order', async () => {
      const diff = pngBuffer(3, 1);
      const { service, getImageBuffer, ollama } = await setup({
        buffers: [pngBuffer(1, 1), pngBuffer(2, 1), diff],
        ollama: modelSaying(true),
      });

      await service.getDiff(input, DEFAULT_CONFIG);

      expect(getImageBuffer.mock.calls).toEqual([['baseline'], ['image'], ['diff.png']]);
      const [[, images]] = ollama.mock.calls;
      expect(images.map((bytes: Uint8Array) => PNG.sync.read(Buffer.from(bytes)).width)).toEqual([1, 2, 3]);
      expect(Buffer.from(images[2]).equals(diff)).toBe(true);
    });

    it('masks ignore areas in a worker job', async () => {
      const run = jest.spyOn(DiffWorkerPool.prototype, 'run');
      const opaque = new PNG({ width: 4, height: 4 });
      opaque.data.fill(255);
      const picture = PNG.sync.write(opaque);
      const { service, ollama } = await setup({
        buffers: [picture, picture, pngBuffer(4, 4)],
        ollama: modelSaying(true),
      });
      const ignoreAreas = [{ x: 1, y: 1, width: 2, height: 2 }];

      await service.getDiff({ ...input, ignoreAreas }, DEFAULT_CONFIG);

      expect(run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'vlm-inputs', ignoreAreas }));
      const [[, [sentBaseline]]] = ollama.mock.calls;
      const png = PNG.sync.read(Buffer.from(sentBaseline));
      const alpha = (x: number, y: number) => png.data[4 * (png.width * y + x) + 3];
      expect([alpha(0, 0), alpha(1, 1), alpha(2, 2), alpha(3, 3)]).toEqual([255, 0, 0, 255]);
      run.mockRestore();
    });

    it.each([
      ['a picture does not decode', [Buffer.from('not a png'), pngBuffer(2, 2), pngBuffer(2, 2)]],
      ['the image does not decode', [pngBuffer(2, 2), Buffer.from('not a png'), pngBuffer(2, 2)]],
      ['a stored picture is missing', [null, pngBuffer(2, 2), pngBuffer(2, 2)]],
    ])('returns the pixelmatch result when %s', async (_, buffers) => {
      const pixelmatch = createPixelmatchResult();
      const { service, ollama } = await setup({ pixelmatch, buffers });

      expect(await service.getDiff(input, DEFAULT_CONFIG)).toStrictEqual(pixelmatch);
      expect(ollama).not.toHaveBeenCalled();
    });
  });

  describe('model concurrency', () => {
    afterEach(() => {
      delete process.env.VLM_CONCURRENCY;
    });

    it('asks the model at most VLM_CONCURRENCY times at once', async () => {
      process.env.VLM_CONCURRENCY = '1';
      const gates: { resolve: (value: { content: string }) => void }[] = [];
      const ollama = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            gates.push({ resolve });
          })
      );
      const { service } = await setup({
        getImageBuffer: jest.fn().mockImplementation(async () => pngBuffer(2, 2)),
        ollama,
      });
      const answer = reply(true, 'ok');

      const first = service.getDiff(input, DEFAULT_CONFIG);
      const second = service.getDiff(input, DEFAULT_CONFIG);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(ollama).toHaveBeenCalledTimes(1);

      gates[0].resolve(answer);
      await first;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(ollama).toHaveBeenCalledTimes(2);

      gates[1].resolve(answer);
      await second;
    });

    it('falls back to the default when VLM_CONCURRENCY is zero', async () => {
      process.env.VLM_CONCURRENCY = '0';
      const { service } = await setup({ ollama: modelSaying(true) });

      const result = await service.getDiff(input, DEFAULT_CONFIG);

      expect(result.status).toBe(TestStatus.ok);
    });
  });

  describe('Gemini provider', () => {
    it('should use GeminiService when provider is gemini', async () => {
      const { service, gemini, ollama } = await setup({ gemini: modelSaying(true, 'No noticeable differences.') });

      const result = await service.getDiff(input, geminiConfig);

      expect(result.status).toBe(TestStatus.ok);
      expect(result.vlmDescription).toBe('No noticeable differences.');
      expect(gemini).toHaveBeenCalledWith(geminiConfig, threeImages);
      expect(ollama).not.toHaveBeenCalled();
    });

    it('should handle error when Gemini API key is missing', async () => {
      const { service } = await setup();
      const { apiKey: _apiKey, ...withoutKey } = geminiConfig;

      const result = await service.getDiff(input, withoutKey as unknown as VlmConfig);

      expect(result.vlmDescription).toContain('VLM analysis failed');
      expect(result.status).toBe(TestStatus.unresolved);
    });
  });
});
