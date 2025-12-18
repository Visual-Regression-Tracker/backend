import { Test, TestingModule } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { StaticService } from '../../../static/static.service';
import { NO_BASELINE_RESULT, EQUAL_RESULT } from '../consts';
import { DEFAULT_CONFIG, VlmService } from './vlm.service';
import { OllamaService } from './ollama.service';
import { PixelmatchService } from '../pixelmatch/pixelmatch.service';
import { DiffResult } from '../../../test-runs/diffResult';

const initService = async ({
  getImageMock = jest.fn(),
  ollamaGenerateMock = jest.fn(),
  pixelmatchGetDiffMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      VlmService,
      {
        provide: StaticService,
        useValue: {
          getImage: getImageMock,
        },
      },
      {
        provide: OllamaService,
        useValue: {
          generate: ollamaGenerateMock,
        },
      },
      {
        provide: PixelmatchService,
        useValue: {
          getDiff: pixelmatchGetDiffMock,
        },
      },
    ],
  }).compile();

  return module.get<VlmService>(VlmService);
};

describe('VlmService', () => {
  const image = new PNG({ width: 20, height: 20 });
  const diffImage = new PNG({ width: 20, height: 20 });

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

  it('should override to OK when pixelmatch finds differences but VLM says not noticeable', async () => {
    const pixelmatchResult: DiffResult = {
      status: TestStatus.unresolved,
      diffName: 'diff.png',
      pixelMisMatchCount: 100,
      diffPercent: 2.5,
      isSameDimension: true,
    };
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const getImageMock = jest
      .fn()
      .mockReturnValueOnce(image) // baseline
      .mockReturnValueOnce(image) // comparison
      .mockReturnValueOnce(diffImage); // diff
    const ollamaGenerateMock = jest.fn().mockResolvedValue({
      model: 'llava:7b',
      created_at: new Date(),
      message: {
        content:
          '{"identical": true, "description": "Differences are minor rendering artifacts, not noticeable to humans."}',
        role: 'assistant',
      },
      done: true,
      done_reason: 'stop',
      total_duration: 1000,
      load_duration: 100,
      prompt_eval_count: 10,
      prompt_eval_duration: 200,
      eval_count: 5,
      eval_duration: 300,
    });
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      DEFAULT_CONFIG
    );

    expect(result.status).toBe(TestStatus.ok); // Overridden by VLM
    expect(result.vlmDescription).toBe('Differences are minor rendering artifacts, not noticeable to humans.');
    expect(result.pixelMisMatchCount).toBe(100); // Preserved from pixelmatch
    expect(result.diffPercent).toBe(2.5); // Preserved from pixelmatch
    expect(result.diffName).toBe('diff.png'); // Preserved from pixelmatch
    expect(ollamaGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            images: expect.arrayContaining([expect.any(Uint8Array), expect.any(Uint8Array), expect.any(Uint8Array)]),
          }),
        ],
      })
    );
  });

  it('should keep unresolved when pixelmatch finds differences and VLM confirms noticeable', async () => {
    const pixelmatchResult: DiffResult = {
      status: TestStatus.unresolved,
      diffName: 'diff.png',
      pixelMisMatchCount: 500,
      diffPercent: 12.5,
      isSameDimension: true,
    };
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const getImageMock = jest
      .fn()
      .mockReturnValueOnce(image) // baseline
      .mockReturnValueOnce(image) // comparison
      .mockReturnValueOnce(diffImage); // diff
    const ollamaGenerateMock = jest.fn().mockResolvedValue({
      model: 'llava:7b',
      created_at: new Date(),
      message: {
        content:
          '{"identical": false, "description": "Button text changed from Submit to Send, and user count changed from 12 to 15."}',
        role: 'assistant',
      },
      done: true,
      done_reason: 'stop',
      total_duration: 1000,
      load_duration: 100,
      prompt_eval_count: 10,
      prompt_eval_duration: 200,
      eval_count: 5,
      eval_duration: 300,
    });
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: true },
      DEFAULT_CONFIG
    );

    expect(result.status).toBe(TestStatus.unresolved); // Kept as unresolved
    expect(result.vlmDescription).toBe(
      'Button text changed from Submit to Send, and user count changed from 12 to 15.'
    );
    expect(result.pixelMisMatchCount).toBe(500); // Preserved from pixelmatch
    expect(result.diffPercent).toBe(12.5); // Preserved from pixelmatch
    expect(result.diffName).toBe('diff.png'); // Preserved from pixelmatch
  });

  it('should handle invalid JSON response as error and return pixelmatch result', async () => {
    const pixelmatchResult: DiffResult = {
      status: TestStatus.unresolved,
      diffName: 'diff.png',
      pixelMisMatchCount: 200,
      diffPercent: 5.0,
      isSameDimension: true,
    };
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const getImageMock = jest
      .fn()
      .mockReturnValueOnce(image) // baseline
      .mockReturnValueOnce(image) // comparison
      .mockReturnValueOnce(diffImage); // diff
    const ollamaGenerateMock = jest.fn().mockResolvedValue({
      model: 'llava:7b',
      created_at: new Date(),
      message: { content: 'Invalid JSON response from model', role: 'assistant' },
      done: true,
      done_reason: 'stop',
      total_duration: 1000,
      load_duration: 100,
      prompt_eval_count: 10,
      prompt_eval_duration: 200,
      eval_count: 5,
      eval_duration: 300,
    });
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      DEFAULT_CONFIG
    );

    expect(result.status).toBe(TestStatus.unresolved); // From pixelmatch
    expect(result.vlmDescription).toContain('VLM analysis failed');
    expect(result.pixelMisMatchCount).toBe(200); // Preserved from pixelmatch
    expect(result.diffPercent).toBe(5.0); // Preserved from pixelmatch
  });

  it('should use custom model and temperature from config', async () => {
    const pixelmatchResult: DiffResult = {
      status: TestStatus.unresolved,
      diffName: 'diff.png',
      pixelMisMatchCount: 150,
      diffPercent: 3.75,
      isSameDimension: true,
    };
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const getImageMock = jest
      .fn()
      .mockReturnValueOnce(image) // baseline
      .mockReturnValueOnce(image) // comparison
      .mockReturnValueOnce(diffImage); // diff
    const ollamaGenerateMock = jest.fn().mockResolvedValue({
      model: 'llava:13b',
      created_at: new Date(),
      message: { content: '{"identical": true, "description": "No differences."}', role: 'assistant' },
      done: true,
      done_reason: 'stop',
      total_duration: 1000,
      load_duration: 100,
      prompt_eval_count: 10,
      prompt_eval_duration: 200,
      eval_count: 5,
      eval_duration: 300,
    });
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      { model: 'llava:13b', prompt: 'Custom context', temperature: 0.2 }
    );

    const VlmComparisonResultSchema = z.object({
      identical: z.boolean(),
      description: z.string(),
    });
    const expectedJsonSchema = z.toJSONSchema(VlmComparisonResultSchema);

    expect(ollamaGenerateMock).toHaveBeenCalledWith({
      model: 'llava:13b',
      messages: [
        {
          role: 'user',
          content: 'Custom context',
          images: expect.arrayContaining([expect.any(Uint8Array), expect.any(Uint8Array), expect.any(Uint8Array)]),
        },
      ],
      format: expectedJsonSchema,
      options: { temperature: 0.2 },
    });
  });

  it('should handle API errors gracefully and return pixelmatch result', async () => {
    const pixelmatchResult: DiffResult = {
      status: TestStatus.unresolved,
      diffName: 'diff.png',
      pixelMisMatchCount: 300,
      diffPercent: 7.5,
      isSameDimension: true,
    };
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const getImageMock = jest
      .fn()
      .mockReturnValueOnce(image) // baseline
      .mockReturnValueOnce(image) // comparison
      .mockReturnValueOnce(diffImage); // diff
    const ollamaGenerateMock = jest.fn().mockRejectedValue(new Error('Connection refused'));
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      DEFAULT_CONFIG
    );

    expect(result.status).toBe(TestStatus.unresolved); // From pixelmatch
    expect(result.vlmDescription).toContain('VLM analysis failed');
    expect(result.pixelMisMatchCount).toBe(300); // Preserved from pixelmatch
    expect(result.diffPercent).toBe(7.5); // Preserved from pixelmatch
    expect(result.diffName).toBe('diff.png'); // Preserved from pixelmatch
  });

  it('should use thinking field when useThinking is true', async () => {
    const pixelmatchResult: DiffResult = {
      status: TestStatus.unresolved,
      diffName: 'diff.png',
      pixelMisMatchCount: 80,
      diffPercent: 2.0,
      isSameDimension: true,
    };
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const getImageMock = jest
      .fn()
      .mockReturnValueOnce(image) // baseline
      .mockReturnValueOnce(image) // comparison
      .mockReturnValueOnce(diffImage); // diff
    const ollamaGenerateMock = jest.fn().mockResolvedValue({
      model: 'llava:7b',
      created_at: new Date(),
      message: {
        content: '{"identical": false, "description": "Content field"}',
        thinking: '{"identical": true, "description": "Thinking field"}',
        role: 'assistant',
      },
      done: true,
      done_reason: 'stop',
      total_duration: 1000,
      load_duration: 100,
      prompt_eval_count: 10,
      prompt_eval_duration: 200,
      eval_count: 5,
      eval_duration: 300,
    });
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      { ...DEFAULT_CONFIG, useThinking: true }
    );

    expect(result.status).toBe(TestStatus.ok); // Overridden by VLM
    expect(result.vlmDescription).toBe('Thinking field');
  });

  it('should handle missing diff image gracefully', async () => {
    const pixelmatchResult: DiffResult = {
      status: TestStatus.unresolved,
      diffName: null, // No diff saved
      pixelMisMatchCount: 100,
      diffPercent: 2.5,
      isSameDimension: true,
    };
    const pixelmatchGetDiffMock = jest.fn().mockResolvedValue(pixelmatchResult);
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(image).mockReturnValueOnce(null); // diff image missing
    const ollamaGenerateMock = jest.fn();
    const service = await initService({ getImageMock, ollamaGenerateMock, pixelmatchGetDiffMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      DEFAULT_CONFIG
    );

    expect(result).toEqual(pixelmatchResult); // Should return pixelmatch result as-is
    expect(ollamaGenerateMock).not.toHaveBeenCalled(); // VLM should not be called
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
});
