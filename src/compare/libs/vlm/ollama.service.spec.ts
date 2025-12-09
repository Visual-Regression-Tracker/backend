import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OllamaService } from './ollama.service';

describe('OllamaService', () => {
  let service: OllamaService;

  beforeEach(async () => {
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
    it('should call Ollama API with correct parameters', async () => {
      const mockResponse = { response: 'YES', done: true };
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.generate({
        model: 'llava',
        prompt: 'Test prompt',
        images: ['base64img'],
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when API returns non-ok status', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(service.generate({ model: 'llava', prompt: 'Test' })).rejects.toThrow(
        'Ollama API returned status 500'
      );
    });

    it('should throw error when OLLAMA_BASE_URL is not configured', async () => {
      const mockConfigService = {
        getOrThrow: jest.fn().mockImplementation(() => {
          throw new Error('Configuration key "OLLAMA_BASE_URL" does not exist');
        }),
      } as any;
      const newService = new OllamaService(mockConfigService);

      await expect(newService.generate({ model: 'llava', prompt: 'Test' })).rejects.toThrow('OLLAMA_BASE_URL');
    });
  });

  describe('listModels', () => {
    it('should return list of models', async () => {
      const mockModels = { models: [{ name: 'llava:7b' }, { name: 'moondream' }] };
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockModels),
      });

      const result = await service.listModels();

      expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/tags');
      expect(result).toEqual(mockModels.models);
    });

    it('should throw error when API fails', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service Unavailable'),
      });

      await expect(service.listModels()).rejects.toThrow('Failed to list models');
    });
  });
});
