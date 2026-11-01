import { CallHandler, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';

const MASK = '••••';
const MIN_KEY_LENGTH_TO_SHOW_TAIL = 12;

type JsonObject = Record<string, unknown>;

const parseObject = (json: string | undefined): JsonObject | undefined => {
  try {
    const value: unknown = JSON.parse(json ?? '');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
  } catch {
    return undefined;
  }
};

const apiKeyOf = (config: JsonObject | undefined): string | undefined =>
  typeof config?.apiKey === 'string' ? config.apiKey : undefined;

export const maskApiKey = (key: string): string =>
  MASK + (key.length >= MIN_KEY_LENGTH_TO_SHOW_TAIL ? key.slice(-4) : '');

export const maskProjectApiKey = <T>(project: T): T => {
  const configJson = (project as { imageComparisonConfig?: unknown } | null)?.imageComparisonConfig;
  const config = typeof configJson === 'string' ? parseObject(configJson) : undefined;
  const apiKey = apiKeyOf(config);
  if (apiKey === undefined) return project;
  return { ...project, imageComparisonConfig: JSON.stringify({ ...config, apiKey: maskApiKey(apiKey) }) };
};

@Injectable()
export class MaskApiKeyInterceptor implements NestInterceptor {
  intercept(_context: unknown, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(map((body: unknown) => (Array.isArray(body) ? body.map(maskProjectApiKey) : maskProjectApiKey(body))));
  }
}

export const hasMaskedApiKey = (config: string): boolean => apiKeyOf(parseObject(config))?.startsWith(MASK) ?? false;

export const keepStoredApiKey = (incomingConfig: string, storedConfig: string | undefined): string => {
  const incoming = parseObject(incomingConfig);
  const storedKey = apiKeyOf(parseObject(storedConfig));
  if (storedKey === undefined || !apiKeyOf(incoming)?.startsWith(MASK)) return incomingConfig;
  return JSON.stringify({ ...incoming, apiKey: storedKey });
};
