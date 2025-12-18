import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OllamaService } from './ollama.service';

// Mock the ollama module
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

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OllamaService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('http://localhost:11434'),
          },
        },
      ],
    }).compile();

    service = module.get<OllamaService>(OllamaService);
  });

  describe('generate', () => {
    it('should call Ollama SDK with correct parameters for Uint8Array', async () => {
      const mockResponse = {
        model: 'llava',
        created_at: new Date(),
        message: { content: 'YES', role: 'assistant' },
        done: true,
        done_reason: 'stop',
        total_duration: 1000,
        load_duration: 100,
        prompt_eval_count: 10,
        prompt_eval_duration: 200,
        eval_count: 5,
        eval_duration: 300,
      };
      mockChat.mockResolvedValue(mockResponse);

      const testBytes = new Uint8Array([1, 2, 3, 4]);
      const result = await service.generate({
        model: 'llava',
        messages: [
          {
            role: 'user',
            content: 'Test prompt',
            images: [testBytes],
          },
        ],
      });

      expect(mockChat).toHaveBeenCalledWith({
        model: 'llava',
        messages: [
          {
            role: 'user',
            content: 'Test prompt',
            images: [testBytes],
          },
        ],
        stream: false,
        format: undefined,
        options: undefined,
      });
      expect(result.message.content).toBe('YES');
      expect(result.done).toBe(true);
    });

    it('should call Ollama SDK with correct parameters for base64 strings', async () => {
      const mockResponse = {
        model: 'llava',
        created_at: new Date(),
        message: { content: 'YES', role: 'assistant' },
        done: true,
        done_reason: 'stop',
        total_duration: 1000,
        load_duration: 100,
        prompt_eval_count: 10,
        prompt_eval_duration: 200,
        eval_count: 5,
        eval_duration: 300,
      };
      mockChat.mockResolvedValue(mockResponse);

      // Use a longer base64 string
      const longBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const result = await service.generate({
        model: 'llava',
        messages: [
          {
            role: 'user',
            content: 'Test prompt',
            images: [longBase64], // base64 string - passed through as-is
          },
        ],
      });

      expect(mockChat).toHaveBeenCalledWith({
        model: 'llava',
        messages: [
          {
            role: 'user',
            content: 'Test prompt',
            images: [longBase64],
          },
        ],
        stream: false,
        format: undefined,
        options: undefined,
      });
      expect(result.message.content).toBe('YES');
      expect(result.done).toBe(true);
    });

    it('should throw error when SDK call fails', async () => {
      mockChat.mockRejectedValue(new Error('Connection refused'));

      await expect(
        service.generate({
          model: 'llava',
          messages: [{ role: 'user', content: 'Test' }],
        })
      ).rejects.toThrow('Connection refused');
    });

    it('should throw error when OLLAMA_BASE_URL is not configured', async () => {
      const mockConfigService = {
        getOrThrow: jest.fn().mockImplementation(() => {
          throw new Error('Configuration key "OLLAMA_BASE_URL" does not exist');
        }),
      } as any;
      const newService = new OllamaService(mockConfigService);

      await expect(
        newService.generate({
          model: 'llava',
          messages: [{ role: 'user', content: 'Test' }],
        })
      ).rejects.toThrow('OLLAMA_BASE_URL');
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
