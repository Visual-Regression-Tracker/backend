import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OllamaService } from './ollama.service';
import { OllamaVlmConfig } from '../../vlm.types';

jest.mock('zod/v3', () => {
  const actualZod = jest.requireActual('zod');
  return actualZod;
});

const mockChat = jest.fn();
const mockList = jest.fn();

jest.mock('ollama', () => {
  const MockOllama = jest.fn().mockImplementation(() => ({
    chat: mockChat,
    list: mockList,
  }));
  return {
    Ollama: MockOllama,
  };
});

describe('OllamaService', () => {
  let service: OllamaService;
  const mockConfigService = {
    getOrThrow: jest.fn().mockReturnValue('http://localhost:11434'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.getOrThrow.mockReturnValue('http://localhost:11434');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OllamaService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<OllamaService>(OllamaService);
  });

  const createConfig = (overrides?: Partial<OllamaVlmConfig>): OllamaVlmConfig => ({
    provider: 'ollama',
    model: 'llava',
    prompt: 'Test prompt',
    temperature: 0.1,
    ...overrides,
  });

  const createMockResponse = (content: string, thinking?: string) => ({
    model: 'llava',
    created_at: new Date(),
    message: { content, thinking, role: 'assistant' as const },
    done: true,
    done_reason: 'stop' as const,
    total_duration: 1000,
    load_duration: 100,
    prompt_eval_count: 10,
    prompt_eval_duration: 200,
    eval_count: 5,
    eval_duration: 300,
  });

  describe('generate (VlmProvider interface)', () => {
    it('should call Ollama SDK with correct parameters and return VlmProviderResponse', async () => {
      const testBytes = new Uint8Array([1, 2, 3, 4]);
      const config = createConfig();
      const mockResponse = createMockResponse('{"identical": true, "description": "No differences"}');
      mockChat.mockResolvedValue(mockResponse);

      const result = await service.generate(config, [testBytes]);

      expect(mockChat).toHaveBeenCalledWith({
        model: config.model,
        messages: [
          {
            role: 'user',
            content: config.prompt,
            images: [testBytes],
          },
        ],
        stream: false,
        format: expect.any(Object),
        options: {
          temperature: config.temperature,
        },
      });
      expect(result.content).toBe('{"identical": true, "description": "No differences"}');
      expect(result.thinking).toBeUndefined();
    });

    it('should handle thinking field in response', async () => {
      const config = createConfig();
      const mockResponse = createMockResponse(
        '{"identical": false}',
        '{"identical": true, "description": "Thinking result"}'
      );
      mockChat.mockResolvedValue(mockResponse);

      const result = await service.generate(config, []);

      expect(result.content).toBe('{"identical": false}');
      expect(result.thinking).toBe('{"identical": true, "description": "Thinking result"}');
    });

    it('should throw error when SDK call fails', async () => {
      const config = createConfig();
      mockChat.mockRejectedValue(new Error('Connection refused'));
      await expect(service.generate(config, [])).rejects.toThrow('Connection refused');
    });

    it('should throw error when OLLAMA_BASE_URL is not configured', async () => {
      const config = createConfig();
      const errorConfigService = {
        getOrThrow: jest.fn().mockImplementation(() => {
          throw new Error('Configuration key "OLLAMA_BASE_URL" does not exist');
        }),
      };
      const newService = new OllamaService(errorConfigService as any);
      await expect(newService.generate(config, [])).rejects.toThrow('OLLAMA_BASE_URL');
    });
  });

  describe('listModels', () => {
    it('should return list of models', async () => {
      const mockDate = new Date('2024-01-01');
      const mockResponse = {
        models: [
          {
            name: 'llava:7b',
            model: 'llava:7b',
            size: 1000,
            digest: 'abc123',
            modified_at: mockDate,
            expires_at: mockDate,
            size_vram: 500,
            details: {
              parent_model: '',
              format: 'gguf',
              family: 'llama',
              families: ['llama'],
              parameter_size: '7B',
              quantization_level: 'Q4_0',
            },
          },
          {
            name: 'moondream',
            model: 'moondream',
            size: 2000,
            digest: 'def456',
            modified_at: mockDate,
            expires_at: mockDate,
            size_vram: 1000,
            details: {
              parent_model: '',
              format: 'gguf',
              family: 'moondream',
              families: ['moondream'],
              parameter_size: '1.6B',
              quantization_level: 'Q4_0',
            },
          },
        ],
      };
      mockList.mockResolvedValue(mockResponse);

      const result = await service.listModels();

      expect(mockList).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.models);
    });

    it('should throw error when API fails', async () => {
      mockList.mockRejectedValue(new Error('Service Unavailable'));

      await expect(service.listModels()).rejects.toThrow('Service Unavailable');
    });
  });
});
