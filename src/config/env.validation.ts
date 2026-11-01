import { Logger } from '@nestjs/common';

export const DEFAULT_JWT_LIFE_TIME = '1d';
export const REFUSED_IN_PRODUCTION_JWT_SECRETS: readonly string[] = ['jwtPrivateKey'];
export const DEVELOPMENT_JWT_SECRET = 'vrt-local-development-only-jwt-secret';

const TIMESPAN =
  /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i;

const text = (value: unknown): string => (value === undefined || value === null ? '' : String(value).trim());

type Warn = Pick<Logger, 'warn'>;

export function validateEnv(
  config: Record<string, unknown>,
  logger: Warn = new Logger('Config')
): Record<string, unknown> {
  const env = { ...config };

  const secret = text(env.JWT_SECRET);
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Generate one, e.g. `openssl rand -hex 32`.');
  }
  if (REFUSED_IN_PRODUCTION_JWT_SECRETS.includes(secret) || secret === DEVELOPMENT_JWT_SECRET) {
    const problem =
      'JWT_SECRET is a publicly known sample value: anyone can sign tokens for any user. Set a random one, e.g. `openssl rand -hex 32`.';
    if (text(env.NODE_ENV) === 'production' && REFUSED_IN_PRODUCTION_JWT_SECRETS.includes(secret)) {
      throw new Error(`${problem} Refusing to start with NODE_ENV=production.`);
    }
    logger.warn(problem);
  }

  const lifeTime = text(env.JWT_LIFE_TIME);
  if (!lifeTime || lifeTime.length > 100 || !TIMESPAN.test(lifeTime)) {
    logger.warn(
      `JWT_LIFE_TIME ${lifeTime ? `"${lifeTime}" is not a timespan` : 'is not set'}; tokens expire after ${DEFAULT_JWT_LIFE_TIME}. Use e.g. "1d" or "12h".`
    );
    env.JWT_LIFE_TIME = DEFAULT_JWT_LIFE_TIME;
  } else if (/^\d+(\.\d+)?$/.test(lifeTime)) {
    logger.warn(
      `JWT_LIFE_TIME "${lifeTime}" has no unit and counts milliseconds; add "s", "h" or "d" if that is not meant.`
    );
  }

  if (!text(env.APP_FRONTEND_URL)) {
    logger.warn('APP_FRONTEND_URL is not set: links in test run results start with "undefined".');
  }
  if (text(env.STATIC_SERVICE) === 's3' && !text(env.AWS_S3_BUCKET_NAME)) {
    logger.warn('STATIC_SERVICE=s3 but AWS_S3_BUCKET_NAME is not set: storing images will fail.');
  }
  return env;
}
