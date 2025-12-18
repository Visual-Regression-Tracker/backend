import { Test, TestingModule } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { StaticService } from '../../../static/static.service';
import { NO_BASELINE_RESULT } from '../consts';
import { DEFAULT_CONFIG, VlmService } from './vlm.service';
import { OllamaService } from './ollama.service';

const initService = async ({ getImageMock = jest.fn(), ollamaGenerateMock = jest.fn() }) => {
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
    ],
  }).compile();

  return module.get<VlmService>(VlmService);
};

describe('VlmService', () => {
  const image = new PNG({ width: 20, height: 20 });

  it('should return NO_BASELINE_RESULT when baseline is missing', async () => {
    const getImageMock = jest.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(image);
    const service = await initService({ getImageMock });

    const result = await service.getDiff(
      { baseline: null, image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: true },
      DEFAULT_CONFIG
    );

    expect(result).toStrictEqual(NO_BASELINE_RESULT);
  });

  it('should return ok status when VLM returns identical=true in JSON', async () => {
    const getImageMock = jest.fn().mockReturnValue(image);
    const ollamaGenerateMock = jest.fn().mockResolvedValue({
      model: 'llava:7b',
      created_at: new Date(),
      message: { content: '{"identical": true, "description": "Screenshots are visually identical."}', role: 'assistant' },
      done: true,
      done_reason: 'stop',
      total_duration: 1000,
      load_duration: 100,
      prompt_eval_count: 10,
      prompt_eval_duration: 200,
      eval_count: 5,
      eval_duration: 300,
    });
    const service = await initService({ getImageMock, ollamaGenerateMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      DEFAULT_CONFIG
    );

    expect(result.status).toBe(TestStatus.ok);
    expect(result.vlmDescription).toBe('Screenshots are visually identical.');
    expect(result.pixelMisMatchCount).toBe(0);
    expect(result.diffPercent).toBe(0);
  });

  it('should return unresolved when VLM returns identical=false in JSON', async () => {
    const getImageMock = jest.fn().mockReturnValue(image);
    const ollamaGenerateMock = jest.fn().mockResolvedValue({
      model: 'llava:7b',
      created_at: new Date(),
      message: { content: '{"identical": false, "description": "Button text changed from Submit to Send."}', role: 'assistant' },
      done: true,
      done_reason: 'stop',
      total_duration: 1000,
      load_duration: 100,
      prompt_eval_count: 10,
      prompt_eval_duration: 200,
      eval_count: 5,
      eval_duration: 300,
    });
    const service = await initService({ getImageMock, ollamaGenerateMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: true },
      DEFAULT_CONFIG
    );

    expect(result.status).toBe(TestStatus.unresolved);
    expect(result.vlmDescription).toBe('Button text changed from Submit to Send.');
    expect(result.diffName).toBeNull();
    expect(result.pixelMisMatchCount).toBe(0);
    expect(result.diffPercent).toBe(0);
  });

  it('should handle invalid JSON response as error', async () => {
    const getImageMock = jest.fn().mockReturnValue(image);
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
    const service = await initService({ getImageMock, ollamaGenerateMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      DEFAULT_CONFIG
    );

    expect(result.status).toBe(TestStatus.unresolved);
    expect(result.vlmDescription).toContain('VLM analysis failed');
  });

  it('should use custom model and temperature from config', async () => {
    const getImageMock = jest.fn().mockReturnValue(image);
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
    const service = await initService({ getImageMock, ollamaGenerateMock });

    await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      { model: 'llava:13b', prompt: 'Custom context', temperature: 0.2 }
    );

    expect(ollamaGenerateMock).toHaveBeenCalledWith({
      model: 'llava:13b',
      messages: [
        {
          role: 'user',
          content: expect.stringContaining('Custom context'),
          images: expect.any(Array),
        },
      ],
      format: 'json',
      options: { temperature: 0.2 },
    });
  });

  it('should handle API errors gracefully', async () => {
    const getImageMock = jest.fn().mockReturnValue(image);
    const ollamaGenerateMock = jest.fn().mockRejectedValue(new Error('Connection refused'));
    const service = await initService({ getImageMock, ollamaGenerateMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      DEFAULT_CONFIG
    );

    expect(result.status).toBe(TestStatus.unresolved);
    expect(result.vlmDescription).toContain('VLM analysis failed');
    expect(result.pixelMisMatchCount).toBe(0);
    expect(result.diffName).toBeNull();
  });

  it('should use thinking field when useThinking is true', async () => {
    const getImageMock = jest.fn().mockReturnValue(image);
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
    const service = await initService({ getImageMock, ollamaGenerateMock });

    const result = await service.getDiff(
      { baseline: 'baseline', image: 'image', diffTollerancePercent: 0.1, ignoreAreas: [], saveDiffAsFile: false },
      { ...DEFAULT_CONFIG, useThinking: true }
    );

    expect(result.status).toBe(TestStatus.ok);
    expect(result.vlmDescription).toBe('Thinking field');
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
