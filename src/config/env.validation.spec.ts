import { Logger } from '@nestjs/common';
import { DEFAULT_JWT_LIFE_TIME, DEVELOPMENT_JWT_SECRET, validateEnv } from './env.validation';

describe('validateEnv', () => {
  const GOOD = { JWT_SECRET: 'a-random-secret', JWT_LIFE_TIME: '12h', APP_FRONTEND_URL: 'http://localhost:8080' };
  let logger: { warn: jest.Mock };

  beforeEach(() => {
    logger = { warn: jest.fn() };
  });

  it('returns a valid config unchanged and silent', () => {
    expect(validateEnv({ ...GOOD, OTHER: 'x' }, logger)).toEqual({ ...GOOD, OTHER: 'x' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not mutate the config it was given', () => {
    const config = { JWT_SECRET: 'a-random-secret' };

    validateEnv(config, logger);

    expect(config).toEqual({ JWT_SECRET: 'a-random-secret' });
  });

  describe('JWT_SECRET', () => {
    it.each([undefined, '', '   '])('refuses to start without it (%p)', (value) => {
      expect(() => validateEnv({ ...GOOD, JWT_SECRET: value }, logger)).toThrow('JWT_SECRET is not set');
    });

    it.each([
      ['the public sample value when NODE_ENV=production', 'jwtPrivateKey', 'production'],
      ['the public sample value when NODE_ENV=development', 'jwtPrivateKey', 'development'],
      ['the public sample value when NODE_ENV is unset', 'jwtPrivateKey', undefined],
      ['the committed development secret in production', DEVELOPMENT_JWT_SECRET, 'production'],
    ])('only warns about %s', (_, secret, nodeEnv) => {
      expect(() => validateEnv({ ...GOOD, JWT_SECRET: secret, NODE_ENV: nodeEnv }, logger)).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('publicly known'));
    });
  });

  describe('JWT_LIFE_TIME', () => {
    it.each([undefined, '', '  ', 'abc', '1 fortnight', 'x'.repeat(101)])(
      'falls back to 1d and warns for %p',
      (value) => {
        const env = validateEnv({ ...GOOD, JWT_LIFE_TIME: value }, logger);

        expect(env.JWT_LIFE_TIME).toBe(DEFAULT_JWT_LIFE_TIME);
        expect(DEFAULT_JWT_LIFE_TIME).toBe('1d');
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('JWT_LIFE_TIME'));
      }
    );

    it.each(['12h', '1d', '30 minutes', '2 days', '500ms', '1.5h'])('accepts %p without a warning', (value) => {
      const env = validateEnv({ ...GOOD, JWT_LIFE_TIME: value }, logger);

      expect(env.JWT_LIFE_TIME).toBe(value);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('keeps a number without a unit but warns that it counts milliseconds', () => {
      const env = validateEnv({ ...GOOD, JWT_LIFE_TIME: '3600' }, logger);

      expect(env.JWT_LIFE_TIME).toBe('3600');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('milliseconds'));
    });
  });

  describe('other settings only warn', () => {
    it('warns when APP_FRONTEND_URL is not set', () => {
      validateEnv({ JWT_SECRET: 'a-random-secret', JWT_LIFE_TIME: '1d' }, logger);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('APP_FRONTEND_URL'));
    });

    it('warns when STATIC_SERVICE=s3 has no bucket', () => {
      validateEnv({ ...GOOD, STATIC_SERVICE: 's3' }, logger);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('AWS_S3_BUCKET_NAME'));
    });

    it('is silent when STATIC_SERVICE=s3 has a bucket', () => {
      validateEnv({ ...GOOD, STATIC_SERVICE: 's3', AWS_S3_BUCKET_NAME: 'vrt' }, logger);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  it('logs through a Nest Logger by default', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    validateEnv({ JWT_SECRET: 'a-random-secret', JWT_LIFE_TIME: 'abc' });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('JWT_LIFE_TIME'));
    warn.mockRestore();
  });
});
