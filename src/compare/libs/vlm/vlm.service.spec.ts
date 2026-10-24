import { Test, TestingModule } from '@nestjs/testing';
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

jest.mock('zod/v3', () => {
  const actualZod = jest.requireActual('zod');
  return actualZod;
});

const initService = async ({
  getImageMock = jest.fn(),
  ollamaGenerateMock = jest.fn(),
  geminiGenerateMock = jest.fn(),
  pixelmatchGetDiffMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      VlmService,
      {
        provide: StaticService,
        useValue: { getImage: getImageMock },
      },
      {
        provide: OllamaService,
        useValue: { generate: ollamaGenerateMock },
      },
      {
        provide: GeminiService,
        useValue: { generate: geminiGenerateMock },
      },
      {
        provide: PixelmatchService,
        useValue: { getDiff: pixelmatchGetDiffMock },
      },
    ],
  }).compile();

  return module.get<VlmService>(VlmService);
};

const createPixelmatchResult = (overrides: Partial<DiffResult>): DiffResult => ({
  status: TestStatus.unresolved,
  diffName: 'diff.png',
  pixelMisMatchCount: 100,
  diffPercent: 2.5,
  isSameDimension: true,
  ...overrides,
});

const createImageMocks = () => {
  const image = new PNG({ width: 20, height: 20 });
  const diffImage = new PNG({ width: 20, height: 20 });
  return {
    image,
    diffImage,
    getImageMock: jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(image).mockReturnValueOnce(diffImage),
  };
};

describe('VlmService', () => {
  it('should return NO_BASELINE_RESULT when pixelmatch returns no baseline', async () => {
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(NO_BASELINE_RESULT);
    const service = await initService({ pixelmatchGetDiffMock });

    const result = await service.getDiff(
      { baseline: null, image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: true },
      DEFAULT_CONFIG
    );

    expect(result).toStrictEqual(NO_BASELINE_RESULT);
    expect(pixelmatchGetDiffMock).toHaveBeenCalled();
  });

  it('should return OK immediately when pixelmatch finds no differences (VLM not called)', async () => {
    const pixelmatchResult: DiffResult = {
      ...EQUAL_RESULT,
      status: TestStatus.ok,
      pixelMisMatchCount: 0,
      diffPercent: 0,
    };
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const ollamaGenerateMock = jest.fn();
    const service = await initService({ pixelmatchGetDiffMock, ollamaGenerateMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      DEFAULT_CONFIG
    );

    expect(result.status).toBe(TestStatus.ok);
    expect(result.pixelMisMatchCount).toBe(0);
    expect(result.diffPercent).toBe(0);
    expect(ollamaGenerateMock).not.toHaveBeenCalled(); // VLM should not be called
  });

  it.each([
    [
      'override to OK when VLM says not noticeable',
      { identical: true, description: 'Differences are minor rendering artifacts, not noticeable to humans.' },
      TestStatus.ok,
      { pixelMisMatchCount: 100, diffPercent: 2.5 },
    ],
    [
      'keep unresolved when VLM confirms noticeable',
      {
        identical: false,
        description: 'Button text changed from Submit to Send, and user count changed from 12 to 15.',
      },
      TestStatus.unresolved,
      { pixelMisMatchCount: 500, diffPercent: 12.5 },
    ],
  ])('should %s', async (_, vlmResponse, expectedStatus, pixelmatchOverrides) => {
    const pixelmatchResult = createPixelmatchResult(pixelmatchOverrides);
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const { getImageMock } = createImageMocks();
    const ollamaGenerateMock = jest.fn().mockResolvedValue({
      content: JSON.stringify(vlmResponse),
    });
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      DEFAULT_CONFIG
    );

    expect(result.status).toBe(expectedStatus);
    expect(result.vlmDescription).toBe(vlmResponse.description);
    expect(result.pixelMisMatchCount).toBe(pixelmatchOverrides.pixelMisMatchCount);
    expect(result.diffPercent).toBe(pixelmatchOverrides.diffPercent);
    expect(ollamaGenerateMock).toHaveBeenCalledWith(
      DEFAULT_CONFIG,
      expect.arrayContaining([expect.any(Uint8Array), expect.any(Uint8Array), expect.any(Uint8Array)])
    );
  });

  it.each([
    [
      'invalid JSON response',
      { content: 'Invalid JSON response from model' },
      { pixelMisMatchCount: 200, diffPercent: 5 },
    ],
    ['API error', null, { pixelMisMatchCount: 300, diffPercent: 7.5 }],
  ])('should handle %s gracefully and return pixelmatch result', async (_, vlmResponse, pixelmatchOverrides) => {
    const pixelmatchResult = createPixelmatchResult(pixelmatchOverrides);
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const { getImageMock } = createImageMocks();
    const ollamaGenerateMock = vlmResponse
      ? jest.fn().mockResolvedValue(vlmResponse)
      : jest.fn().mockRejectedValue(new Error('Connection refused'));
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      DEFAULT_CONFIG
    );

    expect(result.status).toBe(TestStatus.unresolved);
    expect(result.vlmDescription).toContain('VLM analysis failed');
    expect(result.pixelMisMatchCount).toBe(pixelmatchOverrides.pixelMisMatchCount);
    expect(result.diffPercent).toBe(pixelmatchOverrides.diffPercent);
  });

  it.each([
    ['ollama', DEFAULT_CONFIG],
    [
      'gemini',
      {
        provider: 'gemini' as const,
        model: 'gemini-1.5-pro',
        prompt: DEFAULT_CONFIG.prompt,
        temperature: 0.1,
        apiKey: 'test-api-key',
      },
    ],
  ])('should send baseline and image with ignore areas masked to %s', async (_, config) => {
    const createFilledImage = (r: number, g: number, b: number) => {
      const png = new PNG({ width: 20, height: 20 });
      for (let k = 0; k < png.data.length; k += 4) {
        png.data[k] = r;
        png.data[k + 1] = g;
        png.data[k + 2] = b;
        png.data[k + 3] = 255;
      }
      return png;
    };
    const baseline = createFilledImage(255, 255, 255);
    const image = createFilledImage(255, 0, 0);
    const diffImage = new PNG({ width: 20, height: 20 });
    const getImageMock = jest
      .fn()
      .mockReturnValueOnce(baseline)
      .mockReturnValueOnce(image)
      .mockReturnValueOnce(diffImage);
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(createPixelmatchResult({}));
    const generateMock = jest.fn().mockResolvedValue({
      content: '{"identical": false, "description": "Changed."}',
    });
    const service = await initService({
      getImageMock,
      pixelmatchGetDiffMock,
      ollamaGenerateMock: generateMock,
      geminiGenerateMock: generateMock,
    });
    const ignoreAreas = [{ x: 2, y: 3, width: 5, height: 4 }];

    await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas, saveDiffAsFile: false },
      config
    );

    expect(generateMock).toHaveBeenCalledTimes(1);
    const [sentBaseline, sentImage] = (generateMock.mock.calls[0][1] as Uint8Array[]).map((bytes) =>
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
    const pixelmatchResult = createPixelmatchResult({ pixelMisMatchCount: 150, diffPercent: 3.75 });
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const { getImageMock } = createImageMocks();
    const ollamaGenerateMock = jest.fn().mockResolvedValue({
      content: '{"identical": true, "description": "No differences."}',
    });
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    const customConfig = { ...DEFAULT_CONFIG, model: 'llava:13b', prompt: 'Custom context', temperature: 0.2 };
    await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      customConfig
    );

    expect(ollamaGenerateMock).toHaveBeenCalledWith(
      customConfig,
      expect.arrayContaining([expect.any(Uint8Array), expect.any(Uint8Array), expect.any(Uint8Array)])
    );
  });

  it('should use thinking field when useThinking is true', async () => {
    const pixelmatchResult = createPixelmatchResult({ pixelMisMatchCount: 80, diffPercent: 2 });
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const { getImageMock } = createImageMocks();
    const ollamaGenerateMock = jest.fn().mockResolvedValue({
      content: '{"identical": false, "description": "Content field"}',
      thinking: '{"identical": true, "description": "Thinking field"}',
    });
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      { ...DEFAULT_CONFIG, useThinking: true }
    );

    expect(result.status).toBe(TestStatus.ok);
    expect(result.vlmDescription).toBe('Thinking field');
  });

  it('should handle missing diff image gracefully', async () => {
    const pixelmatchResult = createPixelmatchResult({ diffName: null });
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const { image } = createImageMocks();
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(image).mockReturnValueOnce(null);
    const ollamaGenerateMock = jest.fn();
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      DEFAULT_CONFIG
    );

    expect(result).toEqual(pixelmatchResult);
    expect(ollamaGenerateMock).not.toHaveBeenCalled();
  });

  it.each([
    ['empty string', '', DEFAULT_CONFIG],
    ['invalid JSON', 'invalid', DEFAULT_CONFIG],
    ['partial config', '{"model":"llava:7b"}', { model: 'llava:7b' }],
    [
      'full config',
      '{"model":"llava:13b","prompt":"Custom prompt","temperature":0.2,"useThinking":true}',
      {
        model: 'llava:13b',
        prompt: 'Custom prompt',
        temperature: 0.2,
        useThinking: true,
      },
    ],
  ])('should parse config: %s', async (_, configJson, expected) => {
    const service = await initService({});
    expect(service.parseConfig(configJson)).toEqual(expected);
  });

  describe('characterization', () => {
    const input: ImageCompareInput = {
      baseline: 'baseline',
      image: 'image',
      diffTollerancePercent: 0.1,
      ignoreAreas: [],
      saveDiffAsFile: false,
    };

    it('always asks pixelmatch for a saved diff with the pixelmatch defaults', async () => {
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(EQUAL_RESULT);
      const service = await initService({ pixelmatchGetDiffMock });

      await service.getDiff(input, { ...DEFAULT_CONFIG, temperature: 0.9 });

      expect(pixelmatchGetDiffMock).toHaveBeenCalledWith(
        { ...input, saveDiffAsFile: true },
        { threshold: 0.1, ignoreAntialiasing: true }
      );
    });

    it('returns a pixelmatch result with status new without asking the model', async () => {
      const pixelmatchResult = createPixelmatchResult({ status: TestStatus.new });
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
      const getImageMock = jest.fn();
      const ollamaGenerateMock = jest.fn();
      const service = await initService({ pixelmatchGetDiffMock, getImageMock, ollamaGenerateMock });

      const result = await service.getDiff(input, DEFAULT_CONFIG);

      expect(result).toBe(pixelmatchResult);
      expect(getImageMock).not.toHaveBeenCalled();
      expect(ollamaGenerateMock).not.toHaveBeenCalled();
    });

    it('still loads images when pixelmatch reports no baseline', async () => {
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(NO_BASELINE_RESULT);
      const getImageMock = jest.fn().mockResolvedValue(undefined);
      const service = await initService({ pixelmatchGetDiffMock, getImageMock });

      const result = await service.getDiff({ ...input, baseline: null }, DEFAULT_CONFIG);

      // NOTE: current behavior — NO_BASELINE_RESULT has status undefined, not `new`,
      // so the early return above never applies and the VLM path runs until it
      // finds the images missing.
      expect(getImageMock).toHaveBeenCalledWith(null);
      expect(result).toBe(NO_BASELINE_RESULT);
    });

    it('reports an empty model response as a failed analysis', async () => {
      const pixelmatchResult = createPixelmatchResult({});
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
      const { getImageMock } = createImageMocks();
      const ollamaGenerateMock = jest.fn().mockResolvedValue({ content: '', thinking: undefined });
      const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

      const result = await service.getDiff(input, DEFAULT_CONFIG);

      expect(result).toStrictEqual({
        ...pixelmatchResult,
        vlmDescription: 'VLM analysis failed: Empty response from model',
      });
    });

    it('falls back to the thinking field when the content is empty', async () => {
      const { getImageMock } = createImageMocks();
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(createPixelmatchResult({}));
      const ollamaGenerateMock = jest.fn().mockResolvedValue({
        content: '',
        thinking: '{"identical": true, "description": "From thinking"}',
      });
      const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

      const result = await service.getDiff(input, DEFAULT_CONFIG);

      expect(result.status).toBe(TestStatus.ok);
      expect(result.vlmDescription).toBe('From thinking');
    });

    it('falls back to the content field when thinking is preferred but empty', async () => {
      const { getImageMock } = createImageMocks();
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(createPixelmatchResult({}));
      const ollamaGenerateMock = jest.fn().mockResolvedValue({
        content: '{"identical": false, "description": "From content"}',
      });
      const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

      const result = await service.getDiff(input, { ...DEFAULT_CONFIG, useThinking: true });

      expect(result.status).toBe(TestStatus.unresolved);
      expect(result.vlmDescription).toBe('From content');
    });

    it('fills in a description when the model returns an empty one', async () => {
      const { getImageMock } = createImageMocks();
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(createPixelmatchResult({}));
      const ollamaGenerateMock = jest.fn().mockResolvedValue({ content: '{"identical": true, "description": ""}' });
      const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

      const result = await service.getDiff(input, DEFAULT_CONFIG);

      expect(result.vlmDescription).toBe('No description provided');
    });

    it('reports a response that does not match the schema as a failed analysis', async () => {
      const { getImageMock } = createImageMocks();
      const pixelmatchResult = createPixelmatchResult({});
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
      const ollamaGenerateMock = jest.fn().mockResolvedValue({ content: '{"identical": "yes"}' });
      const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

      const result = await service.getDiff(input, DEFAULT_CONFIG);

      expect(result.status).toBe(TestStatus.unresolved);
      expect(result.vlmDescription).toMatch(/^VLM analysis failed: /);
    });

    it.each([
      ['no provider', undefined],
      ['an unknown provider', 'openai'],
    ])('uses Ollama when the config names %s', async (_, provider) => {
      const { getImageMock } = createImageMocks();
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(createPixelmatchResult({}));
      const ollamaGenerateMock = jest.fn().mockResolvedValue({ content: '{"identical": true, "description": "ok"}' });
      const geminiGenerateMock = jest.fn();
      const service = await initService({
        getImageMock,
        ollamaGenerateMock,
        geminiGenerateMock,
        pixelmatchGetDiffMock,
      });
      const config = { ...DEFAULT_CONFIG, provider } as any;

      await service.getDiff(input, config);

      expect(ollamaGenerateMock).toHaveBeenCalledWith(config, expect.any(Array));
      expect(geminiGenerateMock).not.toHaveBeenCalled();
    });

    it('sends baseline, image and diff to the model as PNG bytes in that order', async () => {
      const baseline = new PNG({ width: 1, height: 1 });
      const image = new PNG({ width: 2, height: 1 });
      const diff = new PNG({ width: 3, height: 1 });
      const getImageMock = jest
        .fn()
        .mockResolvedValueOnce(baseline)
        .mockResolvedValueOnce(image)
        .mockResolvedValueOnce(diff);
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(createPixelmatchResult({ diffName: 'diff.png' }));
      const ollamaGenerateMock = jest.fn().mockResolvedValue({ content: '{"identical": true, "description": "ok"}' });
      const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

      await service.getDiff(input, DEFAULT_CONFIG);

      expect(getImageMock.mock.calls).toEqual([['baseline'], ['image'], ['diff.png']]);
      const [[, images]] = ollamaGenerateMock.mock.calls;
      expect(images.map((bytes: Uint8Array) => PNG.sync.read(Buffer.from(bytes)).width)).toEqual([1, 2, 3]);
    });
  });

  describe('Gemini provider', () => {
    it('should use GeminiService when provider is gemini', async () => {
      const pixelmatchResult = createPixelmatchResult({});
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
      const { getImageMock } = createImageMocks();
      const geminiGenerateMock = jest.fn().mockResolvedValue({
        content: '{"identical": true, "description": "No noticeable differences."}',
      });
      const ollamaGenerateMock = jest.fn();
      const service = await initService({
        getImageMock,
        geminiGenerateMock,
        ollamaGenerateMock,
        pixelmatchGetDiffMock,
      });

      const geminiConfig = {
        provider: 'gemini' as const,
        model: 'gemini-1.5-pro',
        prompt: DEFAULT_CONFIG.prompt,
        temperature: 0.1,
        apiKey: 'test-api-key',
      };

      const result = await service.getDiff(
        { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
        geminiConfig
      );

      expect(result.status).toBe(TestStatus.ok);
      expect(result.vlmDescription).toBe('No noticeable differences.');
      expect(geminiGenerateMock).toHaveBeenCalledWith(
        geminiConfig,
        expect.arrayContaining([expect.any(Uint8Array), expect.any(Uint8Array), expect.any(Uint8Array)])
      );
      expect(ollamaGenerateMock).not.toHaveBeenCalled();
    });

    it('should handle error when Gemini API key is missing', async () => {
      const pixelmatchResult = createPixelmatchResult({});
      const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
      const { getImageMock } = createImageMocks();
      const service = await initService({ getImageMock, pixelmatchGetDiffMock });

      const result = await service.getDiff(
        { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
        {
          provider: 'gemini' as const,
          model: 'gemini-1.5-pro',
          prompt: DEFAULT_CONFIG.prompt,
          temperature: 0.1,
        } as any
      );

      expect(result.vlmDescription).toContain('VLM analysis failed');
      expect(result.status).toBe(TestStatus.unresolved);
    });
  });
});
