import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OidcUsersService } from './oidcusers.service';

const advertised = 'http://localhost:8081/realms/vrt';

const discoveryDocument = {
  issuer: advertised,
  authorization_endpoint: `${advertised}/protocol/openid-connect/auth`,
  token_endpoint: `${advertised}/protocol/openid-connect/token`,
  jwks_uri: `${advertised}/protocol/openid-connect/certs`,
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
};

const serviceFor = (issuerUrl: string) => {
  const values: Record<string, string> = {
    OIDC_ISSUER_URL: issuerUrl,
    OIDC_CLIENT_ID: 'vrt-client',
    OIDC_CLIENT_SECRET: 'secret',
  };
  const config = {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
  return new OidcUsersService(config, {} as PrismaService, {} as AuthService);
};

describe('OidcUsersService issuer discovery', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(Response.json(discoveryDocument)));
  });

  afterEach(() => fetchSpy.mockRestore());

  it.each([
    ['a trailing slash', 'http://keycloak:8080/realms/vrt/'],
    ['a different host than the one the IdP advertises', 'http://keycloak:8080/realms/vrt'],
    ['an issuer that is the discovery url', 'http://keycloak:8080/realms/vrt/.well-known/openid-configuration'],
  ])('builds the authorization url with %s', async (_case, issuerUrl) => {
    const { url } = await serviceFor(issuerUrl).getAuthorizationUrl();

    expect(url.startsWith(`${advertised}/protocol/openid-connect/auth?`)).toBe(true);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://keycloak:8080/realms/vrt/.well-known/openid-configuration');
  });
});
