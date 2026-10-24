import { getSeedPgOptions } from '../pg-options';

describe('getSeedPgOptions', () => {
  const url = 'postgresql://user:secret@db:5432/vrt';

  it('passes a plain URL through', () => {
    expect(getSeedPgOptions(url)).toEqual({ connectionString: url, schema: undefined });
  });

  it('uses the schema the migrations were applied to', () => {
    expect(getSeedPgOptions(`${url}?schema=vrt`).schema).toBe('vrt');
  });

  it('encrypts without verifying the certificate under sslmode=require, as Prisma 6 did', () => {
    const { connectionString, schema } = getSeedPgOptions(`${url}?sslmode=require&schema=vrt`);

    expect(new URL(String(connectionString)).searchParams.get('uselibpqcompat')).toBe('true');
    expect(schema).toBe('vrt');
  });

  it('leaves certificate checks on when sslaccept=strict asks for them', () => {
    const strict = `${url}?sslmode=require&sslaccept=strict`;

    expect(getSeedPgOptions(strict).connectionString).toBe(strict);
  });

  it('leaves an unparsable URL for pg to report', () => {
    expect(getSeedPgOptions('not a url')).toEqual({ connectionString: 'not a url' });
  });
});
