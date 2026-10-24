/**
 * The parts of the backend's getPgOptions (src/prisma/prisma.service.ts) the
 * seed needs, so it reaches the same database schema the migrations were just
 * applied to, over TLS the way Prisma 6 used it. This package is built on its
 * own and cannot import from src/.
 */
export function getSeedPgOptions(databaseUrl: string | undefined): { connectionString?: string; schema?: string } {
  let url: URL;
  try {
    url = new URL(databaseUrl ?? '');
  } catch {
    return { connectionString: databaseUrl };
  }
  const sslmode = url.searchParams.get('sslmode');
  // Prisma 6 encrypted without checking the certificate unless sslaccept=strict
  if (
    (sslmode === 'prefer' || sslmode === 'require') &&
    url.searchParams.get('sslaccept') !== 'strict' &&
    !url.searchParams.has('uselibpqcompat')
  ) {
    url.searchParams.set('uselibpqcompat', 'true');
    return { connectionString: url.toString(), schema: url.searchParams.get('schema') ?? undefined };
  }
  return { connectionString: databaseUrl, schema: url.searchParams.get('schema') ?? undefined };
}
