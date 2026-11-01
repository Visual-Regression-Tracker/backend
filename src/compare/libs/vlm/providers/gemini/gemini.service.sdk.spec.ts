import { GeminiService } from './gemini.service';
import { GeminiVlmConfig } from '../../vlm.types';

const config: GeminiVlmConfig = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  prompt: 'Compare the images',
  temperature: 0.1,
  apiKey: 'test-api-key',
};

const jsonResponse = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('GeminiService with the real @google/genai SDK', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    // the SDK picks its endpoint from GOOGLE_* variables a developer shell may set
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GOOGLE_')));
    jest.replaceProperty(process, 'env', env);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the prompt, images and JSON schema to generateContent and returns the response text', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { role: 'model', parts: [{ text: '{"identical":true,"description":"same"}' }] } }],
      })
    );

    const result = await new GeminiService().generate(config, [new Uint8Array([1, 2, 3])]);

    expect(result).toEqual({ content: '{"identical":true,"description":"same"}' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('test-api-key');
    expect(JSON.parse(init.body as string)).toEqual({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Compare the images' }, { inlineData: { data: 'AQID', mimeType: 'image/png' } }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema: expect.objectContaining({ required: ['identical', 'description'] }),
      },
    });
  });

  it('rejects with the API error when Gemini answers with an error status', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT' } }, 400)
    );

    await expect(new GeminiService().generate(config, [])).rejects.toThrow('API key not valid');
  });
});
