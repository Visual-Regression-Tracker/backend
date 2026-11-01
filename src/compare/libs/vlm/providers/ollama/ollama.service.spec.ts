import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Ollama } from 'ollama';
import { OllamaService } from './ollama.service';
import { OllamaVlmConfig } from '../../vlm.types';

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
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.getOrThrow.mockReturnValue('http://localhost:11434');
    mockConfigService.get.mockReset();

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
        format: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: { identical: { type: 'boolean' }, description: { type: 'string' } },
          required: ['identical', 'description'],
          additionalProperties: false,
        },
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

    it('rejects a Gemini config before calling the SDK', async () => {
      const config = { ...createConfig(), provider: 'gemini' } as any;

      await expect(service.generate(config, [])).rejects.toThrow('OllamaService requires OllamaVlmConfig, got gemini');
      expect(mockChat).not.toHaveBeenCalled();
    });

    it('accepts a config without provider', async () => {
      mockChat.mockResolvedValue(createMockResponse('{}'));
      const config = { ...createConfig(), provider: undefined as OllamaVlmConfig['provider'] };

      await expect(service.generate(config, [])).resolves.toEqual({ content: '{}', thinking: undefined });
    });

    it('creates the client once and reuses it', async () => {
      mockChat.mockResolvedValue(createMockResponse('{}'));

      await service.generate(createConfig(), []);
      await service.generate(createConfig(), []);

      expect(mockConfigService.getOrThrow).toHaveBeenCalledTimes(1);
      expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('OLLAMA_BASE_URL');
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

  describe('request timeout', () => {
    type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
    const realFetch = global.fetch;

    afterEach(() => {
      global.fetch = realFetch;
    });

    const sdkFetch = async (): Promise<Fetch> => {
      mockChat.mockResolvedValue(createMockResponse('{}'));
      const fresh = new OllamaService(mockConfigService as any);
      await fresh.generate(createConfig(), []);
      const [options] = (Ollama as unknown as jest.Mock).mock.calls.at(-1)!;
      expect(options.host).toBe('http://localhost:11434');
      return options.fetch;
    };

    const stalledFetch = () =>
      jest.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
          })
      );

    it('gives the SDK its own fetch and signals every request', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock;
      const fetchForSdk = await sdkFetch();

      await fetchForSdk('http://localhost:11434/api/chat', { method: 'POST' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/chat');
      expect(init.method).toBe('POST');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal.aborted).toBe(false);
    });

    it('aborts a request that outlasts its timeout', async () => {
      const realTimeout = AbortSignal.timeout.bind(AbortSignal);
      const timeout = jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(1));
      global.fetch = stalledFetch();
      const fetchForSdk = await sdkFetch();

      await expect(fetchForSdk('http://localhost:11434/api/chat')).rejects.toMatchObject({ name: 'TimeoutError' });
      timeout.mockRestore();
    });

    it('defaults to five minutes', async () => {
      const timeout = jest.spyOn(AbortSignal, 'timeout');
      global.fetch = jest.fn().mockResolvedValue({});
      const fetchForSdk = await sdkFetch();

      await fetchForSdk('http://localhost:11434/api/chat');

      expect(timeout).toHaveBeenCalledWith(300_000);
      timeout.mockRestore();
    });

    it('still honours the signal of the caller', async () => {
      global.fetch = stalledFetch();
      const fetchForSdk = await sdkFetch();
      const controller = new AbortController();

      const request = fetchForSdk('http://localhost:11434/api/chat', { signal: controller.signal });
      controller.abort();

      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('listModels', () => {
    it('should return list of models', async () => {
      const date = new Date('2024-01-01');
      const modelEntry = (name: string, size: number, digest: string, family: string, parameterSize: string) => ({
        name,
        model: name,
        size,
        digest,
        modified_at: date,
        expires_at: date,
        size_vram: size / 2,
        details: {
          parent_model: '',
          format: 'gguf',
          family,
          families: [family],
          parameter_size: parameterSize,
          quantization_level: 'Q4_0',
        },
      });
      const models = [
        modelEntry('llava:7b', 1000, 'abc123', 'llama', '7B'),
        modelEntry('moondream', 2000, 'def456', 'moondream', '1.6B'),
      ];
      mockList.mockResolvedValue({ models });

      const result = await service.listModels();

      expect(mockList).toHaveBeenCalled();
      expect(result).toEqual(models);
    });

    it('should throw error when API fails', async () => {
      mockList.mockRejectedValue(new Error('Service Unavailable'));

      await expect(service.listModels()).rejects.toThrow('Service Unavailable');
    });
  });
});
