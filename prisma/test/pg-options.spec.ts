import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Client } from 'pg';
import { getSeedPgOptions, negotiatePreferredSsl } from '../pg-options';

describe('getSeedPgOptions', () => {
  const url = 'postgresql://user:secret@db:5432/vrt';
  const noVerify = { rejectUnauthorized: false };

  it('tries TLS without checking the certificate when the URL names no sslmode (prefer)', () => {
    expect(getSeedPgOptions(url)).toEqual({
      config: { connectionString: url, ssl: noVerify },
      schema: undefined,
      preferSsl: true,
    });
  });

  it('uses the schema the migrations were applied to', () => {
    expect(getSeedPgOptions(`${url}?schema=vrt`).schema).toBe('vrt');
  });

  it('insists on TLS under sslmode=require and takes the Prisma parameters out of the URL', () => {
    expect(getSeedPgOptions(`${url}?sslmode=require&schema=vrt`)).toEqual({
      config: { connectionString: `${url}?schema=vrt`, ssl: noVerify },
      schema: 'vrt',
      preferSsl: false,
    });
  });

  it('checks the certificate against sslcert under sslaccept=strict', () => {
    const ca = join(mkdtempSync(join(tmpdir(), 'vrt-ca-')), 'server-ca.pem');
    writeFileSync(ca, 'ca-pem');

    const { config } = getSeedPgOptions(`${url}?sslmode=require&sslaccept=strict&sslcert=${encodeURIComponent(ca)}`);

    expect(config).toEqual({ connectionString: url, ssl: { ca: Buffer.from('ca-pem') } });
  });

  it('connects without TLS under sslmode=disable', () => {
    expect(getSeedPgOptions(`${url}?sslmode=disable`).config.ssl).toBe(false);
  });

  it('leaves a URL written for pg to pg', () => {
    const pgUrl = `${url}?sslmode=verify-full`;

    expect(getSeedPgOptions(pgUrl)).toEqual({
      config: { connectionString: pgUrl },
      schema: undefined,
      preferSsl: false,
    });
  });

  it('leaves an unparsable URL for pg to report', () => {
    expect(getSeedPgOptions('not a url')).toEqual({ config: { connectionString: 'not a url' }, preferSsl: false });
  });
});

describe('negotiatePreferredSsl', () => {
  afterEach(() => jest.restoreAllMocks());

  it('falls back to plaintext when the server has no TLS', async () => {
    jest
      .spyOn(Client.prototype, 'connect')
      .mockRejectedValue(new Error('The server does not support SSL connections') as never);
    const end = jest.spyOn(Client.prototype, 'end').mockResolvedValue(undefined as never);
    const config = { connectionString: 'postgresql://db/vrt', ssl: { rejectUnauthorized: false } as unknown };

    await negotiatePreferredSsl(config as never);

    expect(config.ssl).toBe(false);
    expect(end).toHaveBeenCalled();
  });

  it('keeps TLS when the server takes it', async () => {
    jest.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined as never);
    jest.spyOn(Client.prototype, 'end').mockResolvedValue(undefined as never);
    const config = { connectionString: 'postgresql://db/vrt', ssl: { rejectUnauthorized: false } };

    await negotiatePreferredSsl(config);

    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });
});
