import { Logger, LogLevel } from '@nestjs/common';
import { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import { accessSync, constants, mkdirSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';

export const DEFAULT_HTTPS_KEY_PATH = './secrets/ssl.key';
export const DEFAULT_HTTPS_CERT_PATH = './secrets/ssl.cert';
const DEFAULT_LOG_LEVELS: readonly LogLevel[] = ['log', 'error', 'warn', 'fatal'];
const LOG_LEVELS: readonly LogLevel[] = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];

export class StartupCheckError extends Error {}

export function getHttpsOptions(
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Logger, 'log' | 'warn'> = new Logger('Bootstrap')
): HttpsOptions | undefined {
  const keyPath = env.HTTPS_KEY_PATH?.trim() || DEFAULT_HTTPS_KEY_PATH;
  const certPath = env.HTTPS_CERT_PATH?.trim() || DEFAULT_HTTPS_CERT_PATH;
  if (!tlsFileExists(keyPath) || !tlsFileExists(certPath)) {
    if (env.HTTPS_KEY_PATH?.trim() || env.HTTPS_CERT_PATH?.trim()) {
      logger.warn(`HTTPS key or certificate not found (${keyPath}, ${certPath}). Fall back to HTTP`);
    } else {
      logger.log('HTTPS config not found. Fall back to HTTP');
    }
    return undefined;
  }
  return { key: readTlsFile(keyPath), cert: readTlsFile(certPath) };
}

export function assertWritableDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
  } catch (error) {
    throw accessError(dir, 'writable', error);
  }
}

function tlsFileExists(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch (error) {
    throw accessError(path, 'readable', error);
  }
}

function readTlsFile(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (error) {
    throw accessError(path, 'readable', error);
  }
}

function accessError(path: string, access: 'readable' | 'writable', error: unknown): Error {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== 'EACCES' && code !== 'EPERM') return error as Error;
  const uid = process.getuid?.();
  return new StartupCheckError(
    `${resolve(path)} is not ${access} by uid ${uid} (${code}): chown -R ${uid}:${process.getgid?.()} the host directory, volume or file mounted there`
  );
}

export function parseLogLevels(
  value: string | undefined,
  logger: Pick<Logger, 'warn'> = new Logger('Bootstrap')
): LogLevel[] {
  const requested = (value ?? '')
    .split(',')
    .map((level) => level.trim().toLowerCase())
    .filter(Boolean);
  const levels = requested.filter((level): level is LogLevel => (LOG_LEVELS as readonly string[]).includes(level));
  const unknown = requested.filter((level) => !levels.includes(level as LogLevel));
  if (unknown.length) {
    logger.warn(`LOG_LEVEL: unknown levels ignored: ${unknown.join(', ')}`);
  }
  return levels.length ? levels : [...DEFAULT_LOG_LEVELS];
}
