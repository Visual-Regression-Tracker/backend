import { Project } from '@prisma/client';

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

export const maskProjectApiKey = (project: Project): Project => {
  const config = parseObject(project.imageComparisonConfig);
  const apiKey = apiKeyOf(config);
  if (apiKey === undefined) return project;
  return { ...project, imageComparisonConfig: JSON.stringify({ ...config, apiKey: maskApiKey(apiKey) }) };
};

export const keepStoredApiKey = (incomingConfig: string, storedConfig: string | undefined): string => {
  const incoming = parseObject(incomingConfig);
  const storedKey = apiKeyOf(parseObject(storedConfig));
  if (storedKey === undefined || apiKeyOf(incoming) !== maskApiKey(storedKey)) return incomingConfig;
  return JSON.stringify({ ...incoming, apiKey: storedKey });
};
