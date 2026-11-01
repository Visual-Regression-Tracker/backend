import { Logger, LogLevel } from '@nestjs/common';
import { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import { existsSync, readFileSync } from 'fs';

export const DEFAULT_HTTPS_KEY_PATH = './secrets/ssl.key';
export const DEFAULT_HTTPS_CERT_PATH = './secrets/ssl.cert';
const LOG_LEVELS: readonly LogLevel[] = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];

export function getHttpsOptions(
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Logger, 'log' | 'warn'> = new Logger('Bootstrap')
): HttpsOptions | undefined {
  const keyPath = env.HTTPS_KEY_PATH?.trim() || DEFAULT_HTTPS_KEY_PATH;
  const certPath = env.HTTPS_CERT_PATH?.trim() || DEFAULT_HTTPS_CERT_PATH;
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    if (env.HTTPS_KEY_PATH?.trim() || env.HTTPS_CERT_PATH?.trim()) {
      logger.warn(`HTTPS key or certificate not found (${keyPath}, ${certPath}). Fall back to HTTP`);
    } else {
      logger.log('HTTPS config not found. Fall back to HTTP');
    }
    return undefined;
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

export function parseLogLevels(
  value: string | undefined,
  logger: Pick<Logger, 'warn'> = new Logger('Bootstrap')
): LogLevel[] | undefined {
  const requested = (value ?? '')
    .split(',')
    .map((level) => level.trim().toLowerCase())
    .filter(Boolean);
  const levels = requested.filter((level): level is LogLevel => (LOG_LEVELS as readonly string[]).includes(level));
  const unknown = requested.filter((level) => !levels.includes(level as LogLevel));
  if (unknown.length) {
    logger.warn(`LOG_LEVEL: unknown levels ignored: ${unknown.join(', ')}`);
  }
  return levels.length ? levels : undefined;
}
