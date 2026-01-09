import { Test, TestingModule } from '@nestjs/testing';
import { GeminiService } from './gemini.service';
import { GeminiVlmConfig } from '../../vlm.types';

jest.mock('zod/v3', () => {
  const actualZod = jest.requireActual('zod');
  return actualZod;
});

const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => {
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    })),
  };
});

describe('GeminiService', () => {
  let service: GeminiService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GeminiService],
    }).compile();

    service = module.get<GeminiService>(GeminiService);
  });

  const createConfig = (overrides?: Partial<GeminiVlmConfig>): GeminiVlmConfig => ({
    provider: 'gemini',
    model: 'gemini-1.5-pro',
    prompt: 'Test prompt',
    temperature: 0.1,
    apiKey: 'test-api-key',
    ...overrides,
  });

  const createMockResponse = (text: string) => ({
    text,
  });

  describe('generate', () => {
    it('should call Gemini SDK with correct parameters and return VlmProviderResponse', async () => {
      const config = createConfig();
      const testBytes = new Uint8Array([1, 2, 3, 4]);
      const mockResponse = createMockResponse('{"identical": true, "description": "No differences"}');
      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await service.generate(config, [testBytes]);

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: config.model,
        contents: [
          { text: config.prompt },
          {
            inlineData: {
              data: expect.any(String),
              mimeType: 'image/png',
            },
          },
        ],
        config: {
          temperature: config.temperature,
          responseMimeType: 'application/json',
          responseJsonSchema: expect.any(Object),
        },
      });
      expect(result.content).toBe('{"identical": true, "description": "No differences"}');
    });

    it.each([
      ['single image', [new Uint8Array([137, 80, 78, 71])], 2],
      ['multiple images', [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7, 8, 9])], 4],
    ])('should handle %s and convert to base64', async (_, images, expectedPartsCount) => {
      const config = createConfig();
      const mockResponse = createMockResponse('{"identical": true}');
      mockGenerateContent.mockResolvedValue(mockResponse);

      await service.generate(config, images);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.contents.length).toBe(expectedPartsCount);

      if (images.length > 0) {
        const imagePart = callArgs.contents[1];
        expect(imagePart.inlineData.mimeType).toBe('image/png');
        expect(imagePart.inlineData.data).toBe(Buffer.from(images[0]).toString('base64'));
      }
    });

    it('should always include hardcoded JSON schema', async () => {
      const config = createConfig();
      const mockResponse = createMockResponse('{"identical": true}');
      mockGenerateContent.mockResolvedValue(mockResponse);

      await service.generate(config, []);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.responseMimeType).toBe('application/json');
      const schema = callArgs.config.responseJsonSchema;
      expect(schema).toBeDefined();
      expect(schema).toBeTruthy();
    });

    it.each([
      ['API key is missing', { apiKey: '' }, 'Gemini API key is required'],
      ['SDK call fails', { apiKey: 'test-api-key' }, 'API Error'],
    ])('should throw error when %s', async (_, overrides, expectedError) => {
      const config = createConfig(overrides);

      if (expectedError === 'API Error') {
        mockGenerateContent.mockRejectedValue(new Error(expectedError));
      }

      await expect(service.generate(config, [])).rejects.toThrow(expectedError);
    });
  });
});
