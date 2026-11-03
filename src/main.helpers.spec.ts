import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  assertWritableDir,
  DEFAULT_HTTPS_CERT_PATH,
  DEFAULT_HTTPS_KEY_PATH,
  getHttpsOptions,
  parseLogLevels,
  StartupCheckError,
} from './main.helpers';

const owner = `${process.getuid?.()}:${process.getgid?.()}`;
const itAsNonRoot = process.getuid?.() === 0 ? it.skip : it;

describe('getHttpsOptions', () => {
  let dir: string;
  let logger: { log: jest.Mock; warn: jest.Mock };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vrt-https-'));
    logger = { log: jest.fn(), warn: jest.fn() };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the key and certificate from HTTPS_KEY_PATH and HTTPS_CERT_PATH', () => {
    writeFileSync(join(dir, 'a.key'), 'KEY');
    writeFileSync(join(dir, 'a.cert'), 'CERT');

    const options = getHttpsOptions(
      { HTTPS_KEY_PATH: join(dir, 'a.key'), HTTPS_CERT_PATH: join(dir, 'a.cert') },
      logger
    );

    expect(options).toEqual({ key: Buffer.from('KEY'), cert: Buffer.from('CERT') });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps the documented default paths', () => {
    expect(DEFAULT_HTTPS_KEY_PATH).toBe('./secrets/ssl.key');
    expect(DEFAULT_HTTPS_CERT_PATH).toBe('./secrets/ssl.cert');
  });

  const inEmptyDir = <T>(fn: () => T): T => {
    const original = process.cwd();
    process.chdir(dir);
    try {
      return fn();
    } finally {
      process.chdir(original);
    }
  };

  it('falls back to HTTP with a log line when no files are there and nothing is configured', () => {
    expect(inEmptyDir(() => getHttpsOptions({}, logger))).toBeUndefined();

    expect(logger.log).toHaveBeenCalledWith('HTTPS config not found. Fall back to HTTP');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to HTTP with a warning when the configured files are missing', () => {
    const env = { HTTPS_KEY_PATH: join(dir, 'missing.key'), HTTPS_CERT_PATH: join(dir, 'missing.cert') };

    expect(getHttpsOptions(env, logger)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('missing.key'));
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('warns when only one of the two paths is configured and the other default is absent', () => {
    writeFileSync(join(dir, 'a.key'), 'KEY');

    expect(getHttpsOptions({ HTTPS_KEY_PATH: join(dir, 'a.key') }, logger)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  itAsNonRoot('stops startup with the chown fix when the key exists but is not readable', () => {
    writeFileSync(join(dir, 'a.key'), 'KEY');
    writeFileSync(join(dir, 'a.cert'), 'CERT');
    chmodSync(join(dir, 'a.key'), 0o000);
    const read = () =>
      getHttpsOptions({ HTTPS_KEY_PATH: join(dir, 'a.key'), HTTPS_CERT_PATH: join(dir, 'a.cert') }, logger);

    expect(read).toThrow(StartupCheckError);
    expect(read).toThrow(
      `${join(dir, 'a.key')} is not readable by uid ${process.getuid?.()} (EACCES): chown -R ${owner}`
    );
  });

  itAsNonRoot('stops startup instead of serving HTTP when the TLS directory cannot be searched', () => {
    mkdirSync(join(dir, 'secrets'));
    writeFileSync(join(dir, 'secrets', 'a.key'), 'KEY');
    writeFileSync(join(dir, 'secrets', 'a.cert'), 'CERT');
    chmodSync(join(dir, 'secrets'), 0o000);
    const env = { HTTPS_KEY_PATH: join(dir, 'secrets', 'a.key'), HTTPS_CERT_PATH: join(dir, 'secrets', 'a.cert') };

    try {
      expect(() => getHttpsOptions(env, logger)).toThrow(`${env.HTTPS_KEY_PATH} is not readable`);
    } finally {
      chmodSync(join(dir, 'secrets'), 0o700);
    }
  });

  it('stops startup without a chown hint when a configured path is a directory', () => {
    mkdirSync(join(dir, 'a.key'));
    writeFileSync(join(dir, 'a.cert'), 'CERT');
    const read = () =>
      getHttpsOptions({ HTTPS_KEY_PATH: join(dir, 'a.key'), HTTPS_CERT_PATH: join(dir, 'a.cert') }, logger);

    expect(read).toThrow(/EISDIR/);
    expect(read).not.toThrow(StartupCheckError);
  });

  it('treats blank paths as not configured', () => {
    expect(inEmptyDir(() => getHttpsOptions({ HTTPS_KEY_PATH: '  ', HTTPS_CERT_PATH: '' }, logger))).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalled();
  });
});

describe('assertWritableDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vrt-images-'));
  });

  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a writable directory', () => {
    expect(() => assertWritableDir(dir)).not.toThrow();
  });

  it('creates a missing directory', () => {
    assertWritableDir(join(dir, 'imageUploads'));

    expect(existsSync(join(dir, 'imageUploads'))).toBe(true);
  });

  itAsNonRoot('stops startup with the chown fix when the directory is not writable', () => {
    chmodSync(dir, 0o500);

    expect(() => assertWritableDir(dir)).toThrow(StartupCheckError);
    expect(() => assertWritableDir(dir)).toThrow(
      new StartupCheckError(
        `${dir} is not writable by uid ${process.getuid?.()} (EACCES): chown -R ${owner} the host directory, volume or file mounted there`
      )
    );
  });

  itAsNonRoot('names the directory that cannot be created', () => {
    chmodSync(dir, 0o500);

    expect(() => assertWritableDir(join(dir, 'imageUploads'))).toThrow(join(dir, 'imageUploads'));
  });
});

describe('parseLogLevels', () => {
  let logger: { warn: jest.Mock };

  beforeEach(() => {
    logger = { warn: jest.fn() };
  });

  it.each([undefined, '', '  ,, '])('keeps Nest default (every level) for %p', (value) => {
    expect(parseLogLevels(value, logger)).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('parses a comma separated list, trimming and lower-casing', () => {
    expect(parseLogLevels('warn, ERROR', logger)).toEqual(['warn', 'error']);
  });

  it('ignores unknown levels with a warning', () => {
    expect(parseLogLevels('warn,loud', logger)).toEqual(['warn']);
    expect(logger.warn).toHaveBeenCalledWith('LOG_LEVEL: unknown levels ignored: loud');
  });

  it('keeps Nest default when no level is known', () => {
    expect(parseLogLevels('loud', logger)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
