import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getSeedPgOptions } from '../pg-options';

describe('getSeedPgOptions', () => {
  const url = 'postgresql://user:secret@db:5432/vrt';
  const noVerify = { rejectUnauthorized: false };

  it('connects without TLS when the URL names no sslmode', () => {
    expect(getSeedPgOptions(url)).toEqual({ config: { connectionString: url }, schema: undefined });
  });

  it('insists on TLS under sslmode=require and takes the Prisma parameters out of the URL', () => {
    expect(getSeedPgOptions(`${url}?sslmode=require&schema=vrt`)).toEqual({
      config: { connectionString: `${url}?schema=vrt`, ssl: noVerify },
      schema: 'vrt',
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
    });
  });
});
