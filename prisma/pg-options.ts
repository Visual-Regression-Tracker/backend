import { readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { ClientConfig } from 'pg';

/** Mirrors getPgOptions (src/prisma/prisma.service.ts); this package cannot import from src/. */
const PRISMA_SSL_PARAMS = ['sslmode', 'sslaccept', 'sslcert'];
const PG_ONLY_SSL_PARAMS = ['sslrootcert', 'sslkey', 'uselibpqcompat'];

export function getSeedPgOptions(databaseUrl: string | undefined): {
  config: ClientConfig;
  schema?: string;
} {
  let url: URL;
  try {
    url = new URL(databaseUrl ?? '');
  } catch {
    return { config: { connectionString: databaseUrl } };
  }
  const params = url.searchParams;
  const schema = params.get('schema') ?? undefined;
  const sslmode = params.get('sslmode');
  if (
    sslmode === null ||
    !['prefer', 'require', 'disable'].includes(sslmode) ||
    PG_ONLY_SSL_PARAMS.some((name) => params.has(name))
  ) {
    return { config: { connectionString: databaseUrl }, schema };
  }
  const sslcert = params.get('sslcert');
  const ssl =
    params.get('sslaccept') === 'strict'
      ? { ...(sslcert && { ca: readFileSync(isAbsolute(sslcert) ? sslcert : resolve(__dirname, sslcert)) }) }
      : { rejectUnauthorized: false };
  PRISMA_SSL_PARAMS.forEach((name) => url.searchParams.delete(name));
  return {
    config: { connectionString: url.toString(), ssl: sslmode === 'disable' ? false : ssl },
    schema,
  };
}
