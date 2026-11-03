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

  it('leaves a URL written for pg to pg', () => {
    const pgUrl = `${url}?sslmode=verify-full`;

    expect(getSeedPgOptions(pgUrl)).toEqual({
      config: { connectionString: pgUrl },
      schema: undefined,
      preferSsl: false,
    });
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

  it('fails when the server cannot be reached, so the seed does not run on a guessed TLS setting', async () => {
    jest
      .spyOn(Client.prototype, 'connect')
      .mockRejectedValue(new Error('connect ECONNREFUSED 172.18.0.2:5432') as never);
    const end = jest.spyOn(Client.prototype, 'end').mockResolvedValue(undefined as never);
    const config = { connectionString: 'postgresql://db/vrt', ssl: { rejectUnauthorized: false } };

    await expect(negotiatePreferredSsl(config)).rejects.toThrow('ECONNREFUSED');
    expect(end).toHaveBeenCalled();
  });
});
