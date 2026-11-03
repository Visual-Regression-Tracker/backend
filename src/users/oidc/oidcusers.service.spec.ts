import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { allowInsecureRequests, customFetch } from 'openid-client';
import { Agent } from 'undici';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OidcUsersService } from './oidcusers.service';
import { Prisma as PrismaRuntime } from '@prisma/client';
const { PrismaClientKnownRequestError } = PrismaRuntime;

const mockDiscovery = jest.fn();
const mockBuildAuthorizationUrl = jest.fn();
const mockAuthorizationCodeGrant = jest.fn();
const mockFetchUserInfo = jest.fn();

jest.mock('openid-client', () => ({
  discovery: (...args: unknown[]) => mockDiscovery(...args),
  buildAuthorizationUrl: (...args: unknown[]) => mockBuildAuthorizationUrl(...args),
  authorizationCodeGrant: (...args: unknown[]) => mockAuthorizationCodeGrant(...args),
  fetchUserInfo: (...args: unknown[]) => mockFetchUserInfo(...args),
  randomState: () => 'mock-state',
  randomPKCECodeVerifier: () => 'mock-verifier',
  calculatePKCECodeChallenge: () => Promise.resolve('mock-challenge'),
  allowInsecureRequests: jest.fn(),
  customFetch: Symbol('customFetch'),
}));

const oidcConfig = { issuer: 'https://idp.example.com' };

const user: User = {
  id: '1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  apiKey: 'generatedApiKey',
  password: 'encryptedPassword',
  isActive: true,
  role: Role.editor,
  updatedAt: new Date(),
  createdAt: new Date(),
};

const findUnique = jest.fn();
const create = jest.fn();
const update = jest.fn();

const configService = {
  get: jest.fn((key: string, defaultValue?: string) => {
    const values: Record<string, string> = {
      OIDC_ISSUER_URL: 'https://idp.example.com',
      OIDC_CLIENT_ID: 'vrt-client',
      OIDC_CLIENT_SECRET: 'secret',
      APP_FRONTEND_URL: 'http://localhost:8080',
    };
    return values[key] ?? defaultValue;
  }),
  getOrThrow: jest.fn((key: string) => {
    const values: Record<string, string> = {
      OIDC_ISSUER_URL: 'https://idp.example.com',
      OIDC_CLIENT_ID: 'vrt-client',
      OIDC_CLIENT_SECRET: 'secret',
    };
    if (!(key in values)) {
      throw new Error(`Missing config ${key}`);
    }
    return values[key];
  }),
} as unknown as ConfigService;

const authService = {
  generateApiKey: jest.fn(() => 'generatedApiKey'),
  encryptPassword: jest.fn(() => 'encryptedPassword'),
  signToken: jest.fn(() => 'vrt-jwt'),
} as unknown as AuthService;

const prismaService = {
  user: { findUnique, create, update },
} as unknown as PrismaService;

const configWith = (overrides: Record<string, string> = {}): ConfigService =>
  ({
    get: jest.fn((key: string, defaultValue?: string) =>
      key in overrides ? overrides[key] : configService.get(key, defaultValue)
    ),
    getOrThrow: jest.fn((key: string) => (key in overrides ? overrides[key] : configService.getOrThrow(key))),
  }) as unknown as ConfigService;

const serviceWith = (overrides: Record<string, string> = {}) =>
  new OidcUsersService(configWith(overrides), prismaService, authService);

const idpReturns = (claims: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  mockAuthorizationCodeGrant.mockResolvedValue({ claims: () => claims, ...extra });

const noUser = () => {
  findUnique.mockResolvedValue(null);
  create.mockImplementation(({ data }) => ({ ...user, ...data }));
};

const checks = { state: 'mock-state', codeVerifier: 'mock-verifier' };
const login = (svc: OidcUsersService, params: Record<string, string> = { code: 'code', state: 'mock-state' }) =>
  svc.handleCallback(params, checks);
const expectLoginFailed = (svc: OidcUsersService, params?: Record<string, string>) =>
  expect(login(svc, params)).rejects.toThrow('OIDC login failed.');
const expectCreatedWith = (data: object) =>
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining(data) }));
const expectRoleUpdate = (role: Role) =>
  expect(update).toHaveBeenCalledWith({ where: { id: user.id }, data: { role } });

describe('OidcUsersService', () => {
  let service: OidcUsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDiscovery.mockResolvedValue(oidcConfig);
    mockBuildAuthorizationUrl.mockReturnValue(new URL('https://idp.example.com/authorize?client_id=vrt-client'));
    service = serviceWith();
  });

  const discoveryOptions = () => mockDiscovery.mock.calls[0][4] as Record<string | symbol, unknown>;
  const fetchStub = () => jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

  describe('getAuthorizationUrl', () => {
    it('returns the IdP url together with state and PKCE verifier', async () => {
      const result = await service.getAuthorizationUrl();

      expect(result).toEqual({
        url: 'https://idp.example.com/authorize?client_id=vrt-client',
        state: 'mock-state',
        codeVerifier: 'mock-verifier',
      });
      expect(mockBuildAuthorizationUrl).toHaveBeenCalledWith(oidcConfig, {
        redirect_uri: 'http://localhost:4200/users/oidc/callback',
        scope: 'openid profile email',
        state: 'mock-state',
        code_challenge: 'mock-challenge',
        code_challenge_method: 'S256',
      });
    });

    it('discovers the issuer with the client id and redirect uri', async () => {
      await service.getAuthorizationUrl();

      expect(mockDiscovery).toHaveBeenCalledWith(
        new URL('https://idp.example.com/.well-known/openid-configuration'),
        'vrt-client',
        { redirect_uris: ['http://localhost:4200/users/oidc/callback'], response_types: ['code'] },
        expect.any(Function),
        { execute: [] }
      );
    });

    it.each([
      ['vrt-client', 'secret', 'vrt-client:secret'],
      ['a.b_c-d~e', "s!*'()", "a.b_c-d~e:s!*'()"],
      ['id with space', 'p:w/d', 'id+with+space:p%3Aw%2Fd'],
    ])('authenticates %p with client_secret_basic encoded as openid-client 5 did', async (clientId, secret, pair) => {
      await serviceWith({ OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: secret }).getAuthorizationUrl();
      const clientAuth = mockDiscovery.mock.calls[0][3] as (...args: unknown[]) => void;
      const headers = new Headers();

      clientAuth({}, {}, new URLSearchParams(), headers);

      expect(headers.get('authorization')).toBe(`Basic ${Buffer.from(pair).toString('base64')}`);
    });

    it.each([
      ['https://idp.example.com/', 'https://idp.example.com/.well-known/openid-configuration'],
      ['https://idp.example.com/realms/vrt/', 'https://idp.example.com/realms/vrt/.well-known/openid-configuration'],
      ['http://keycloak:8080/realms/vrt', 'http://keycloak:8080/realms/vrt/.well-known/openid-configuration'],
      [
        'https://idp.example.com/tenant/.well-known/openid-configuration',
        'https://idp.example.com/tenant/.well-known/openid-configuration',
      ],
    ])(
      'fetches the discovery document of %p from %p, so the advertised issuer need not match it',
      async (issuer, url) => {
        await serviceWith({ OIDC_ISSUER_URL: issuer }).getAuthorizationUrl();

        expect(mockDiscovery.mock.calls[0][0]).toEqual(new URL(url));
      }
    );

    it('discovers the issuer only once', async () => {
      await service.getAuthorizationUrl();
      await service.getAuthorizationUrl();

      expect(mockDiscovery).toHaveBeenCalledTimes(1);
    });

    it('retries discovery after a transient failure', async () => {
      mockDiscovery.mockRejectedValueOnce(new Error('discovery down'));

      await expect(service.getAuthorizationUrl()).rejects.toThrow('discovery down');
      await expect(service.getAuthorizationUrl()).resolves.toBeDefined();

      expect(mockDiscovery).toHaveBeenCalledTimes(2);
    });

    it('allows a plain HTTP issuer and warns about it', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await serviceWith({ OIDC_ISSUER_URL: 'http://localhost:8090/default' }).getAuthorizationUrl();

      expect(discoveryOptions().execute).toEqual([allowInsecureRequests]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('plain HTTP'));
      warn.mockRestore();
    });

    it('warns that a redirect uri with a query string cannot match at the token endpoint', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      serviceWith({ OIDC_REDIRECT_URI: 'https://vrt.example.com/users/oidc/callback?tenant=a' });

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('OIDC_REDIRECT_URI'));
      warn.mockRestore();
    });

    it('sends requests to the issuer through a dispatcher that skips TLS verification', async () => {
      const fetchSpy = fetchStub();
      await serviceWith({ OIDC_TLS_NO_VERIFY: 'true' }).getAuthorizationUrl();
      const insecureFetch = discoveryOptions()[customFetch] as (url: string, options: object) => Promise<Response>;

      await insecureFetch('https://idp.example.com/token', { method: 'POST' });

      expect(fetchSpy).toHaveBeenCalledWith('https://idp.example.com/token', {
        method: 'POST',
        dispatcher: expect.any(Agent),
      });
      fetchSpy.mockRestore();
    });

    it('verifies TLS for every other origin even when OIDC_TLS_NO_VERIFY is set', async () => {
      const fetchSpy = fetchStub();
      await serviceWith({ OIDC_TLS_NO_VERIFY: 'true' }).getAuthorizationUrl();
      const insecureFetch = discoveryOptions()[customFetch] as (url: string, options: object) => Promise<Response>;

      await insecureFetch('https://other.example.com/jwks', { method: 'GET' });

      expect(fetchSpy).toHaveBeenCalledWith('https://other.example.com/jwks', { method: 'GET' });
      fetchSpy.mockRestore();
    });

    it('uses the default fetch when TLS verification is on', async () => {
      await service.getAuthorizationUrl();

      expect(discoveryOptions()).not.toHaveProperty([customFetch]);
    });
  });

  describe('buildFrontendRedirect', () => {
    it('puts the token into the url fragment', () => {
      expect(service.buildFrontendRedirect('vrt-jwt')).toBe('http://localhost:8080/login#token=vrt-jwt');
    });

    it('adds an error fragment when no token is present', () => {
      expect(service.buildFrontendRedirect()).toBe('http://localhost:8080/login#error=oidc_login_failed');
    });
  });

  describe('handleCallback', () => {
    it('creates a new user and derives the admin role from the claims', async () => {
      idpReturns(
        {
          email: 'new.user@example.com',
          email_verified: true,
          given_name: 'New',
          family_name: 'User',
          groups: ['vrt-admin'],
        },
        { access_token: 'access-token' }
      );
      noUser();

      const result = await login(service);

      expectCreatedWith({ email: 'new.user@example.com', firstName: 'New', lastName: 'User', role: Role.admin });
      expect(result.token).toBe('vrt-jwt');
    });

    it('falls back to the editor role when no admin claim matches', async () => {
      idpReturns({
        email: 'plain@example.com',
        email_verified: true,
        given_name: 'Plain',
        family_name: 'User',
        groups: ['other'],
      });
      noUser();

      await login(service);

      expectCreatedWith({ role: Role.editor });
    });

    it('updates the role of an existing user from the claims', async () => {
      idpReturns({ email: 'test@example.com', email_verified: true, groups: ['admin'] });
      findUnique.mockResolvedValue(user);
      update.mockResolvedValue({ ...user, role: Role.admin });

      const result = await login(service);

      expectRoleUpdate(Role.admin);
      expect(result.token).toBe('vrt-jwt');
    });

    it('throws when the email claim is missing', async () => {
      idpReturns({ given_name: 'No', family_name: 'Mail' });

      await expectLoginFailed(service);
    });

    it('exchanges the code on the configured redirect uri with the state and PKCE checks', async () => {
      idpReturns({ email: 'test@example.com', email_verified: true });
      findUnique.mockResolvedValue(user);

      await login(service, { code: 'the-code', state: 'mock-state', iss: 'https://idp.example.com' });

      const [config, currentUrl, grantChecks] = mockAuthorizationCodeGrant.mock.calls[0];
      expect(config).toBe(oidcConfig);
      expect((currentUrl as URL).href).toBe(
        'http://localhost:4200/users/oidc/callback?code=the-code&state=mock-state&iss=https%3A%2F%2Fidp.example.com'
      );
      expect(grantChecks).toEqual({
        expectedState: 'mock-state',
        pkceCodeVerifier: 'mock-verifier',
        idTokenExpected: true,
      });
    });

    it('throws when the callback validation fails', async () => {
      mockAuthorizationCodeGrant.mockRejectedValue(new Error('state mismatch'));

      await expectLoginFailed(service, { code: 'code', state: 'wrong' });
    });

    it('falls back to the userinfo endpoint when the email claim is missing', async () => {
      idpReturns({ sub: 'user-1' }, { access_token: 'access-token' });
      mockFetchUserInfo.mockResolvedValue({
        email: 'from.userinfo@example.com',
        email_verified: true,
        given_name: 'Info',
        family_name: 'User',
      });
      noUser();

      await login(service);

      expect(mockFetchUserInfo).toHaveBeenCalledWith(oidcConfig, 'access-token', 'user-1');
      expectCreatedWith({ email: 'from.userinfo@example.com' });
    });

    it('still fails when the userinfo request fails and no email is present', async () => {
      idpReturns({ sub: 'user-1' }, { access_token: 'access-token' });
      mockFetchUserInfo.mockRejectedValue(new Error('userinfo down'));

      await expectLoginFailed(service);
    });

    it('rejects an email the provider marks as unverified', async () => {
      idpReturns({ email: 'unverified@example.com', email_verified: false });

      await expectLoginFailed(service);
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('accepts an unverified email when the check is disabled', async () => {
      idpReturns({ email: 'unverified@example.com', email_verified: false });
      findUnique.mockResolvedValue(user);

      const result = await login(serviceWith({ OIDC_REQUIRE_VERIFIED_EMAIL: 'false' }));

      expect(result.token).toBe('vrt-jwt');
    });

    it('rejects a missing email even when unverified emails are allowed', async () => {
      idpReturns({ sub: 'user-1' });

      await expectLoginFailed(serviceWith({ OIDC_REQUIRE_VERIFIED_EMAIL: 'false' }));

      expect(findUnique).not.toHaveBeenCalled();
    });

    it('rejects an empty email claim array', async () => {
      idpReturns({ email: [] as string[] });

      await expectLoginFailed(service);
    });

    it('accepts an email_verified claim serialized as a string', async () => {
      idpReturns({ email: 'test@example.com', email_verified: 'true', groups: ['editor'] });
      findUnique.mockResolvedValue(user);

      const result = await login(service);

      expect(result.token).toBe('vrt-jwt');
    });

    it.each([
      ['a dotted path into nested claims', 'realm_access.roles', { realm_access: { roles: ['vrt-admin'] } }],
      [
        'an exact claim name containing dots',
        'https://vrt.example.com/roles',
        { 'https://vrt.example.com/roles': ['vrt-admin'] },
      ],
    ])('reads the role claim via %s', async (_label, roleClaim, roleClaims) => {
      idpReturns({ email: 'test@example.com', email_verified: true, ...roleClaims });
      findUnique.mockResolvedValue(user);
      update.mockResolvedValue({ ...user, role: Role.admin });

      await login(serviceWith({ OIDC_ROLE_CLAIM: roleClaim }));

      expectRoleUpdate(Role.admin);
    });

    it('uses the user a concurrent first login created', async () => {
      idpReturns({ email: 'race@example.com', email_verified: true });
      findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...user, email: 'race@example.com' });
      create.mockRejectedValue(new PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' }));

      const result = await login(service);

      expect(findUnique).toHaveBeenCalledTimes(2);
      expect(result.token).toBe('vrt-jwt');
    });

    it('rethrows a unique violation that is not a concurrent login', async () => {
      idpReturns({ email: 'race@example.com', email_verified: true });
      findUnique.mockResolvedValue(null);
      const error = new PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' });
      create.mockRejectedValue(error);

      await expect(login(service)).rejects.toBe(error);
    });

    it('keeps the role of an existing user when the role claim is missing', async () => {
      idpReturns({ email: 'test@example.com', email_verified: true });
      findUnique.mockResolvedValue({ ...user, role: Role.admin });

      const result = await login(service);

      expect(update).not.toHaveBeenCalled();
      expect(result.token).toBe('vrt-jwt');
    });

    it('leaves an existing user unchanged when the role already matches', async () => {
      idpReturns({ email: 'test@example.com', email_verified: true, groups: ['editor'] });
      findUnique.mockResolvedValue(user);

      const result = await login(service);

      expect(update).not.toHaveBeenCalled();
      expect(result.token).toBe('vrt-jwt');
    });

    it('warns and keeps the role of an existing user when the role claim is missing', async () => {
      idpReturns({ email: 'test@example.com', email_verified: true });
      findUnique.mockResolvedValue({ ...user, role: Role.admin });
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      await login(service);

      expect(warn).toHaveBeenCalledWith("Claim 'groups' not found for 'test@example.com'. Keeping role 'admin'.");
      expect(update).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing parent claim', {}],
      ['a null parent claim', { realm_access: null }],
      ['a parent claim that is not an object', { realm_access: 'admin' }],
    ])('treats a dotted role claim with %s as missing', async (_case, parent) => {
      idpReturns({ email: 'test@example.com', email_verified: true, ...parent });
      findUnique.mockResolvedValue({ ...user, role: Role.admin });

      await login(serviceWith({ OIDC_ROLE_CLAIM: 'realm_access.length' }));

      expect(update).not.toHaveBeenCalled();
    });

    it.each([
      ['another prisma error', new PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '5' })],
      ['a non-prisma error', new Error('db down')],
    ])('rethrows %s from creating the user without looking it up again', async (_case, error) => {
      idpReturns({ email: 'race@example.com', email_verified: true });
      findUnique
        .mockReset()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ ...user, email: 'race@example.com' });
      create.mockRejectedValue(error);

      await expect(login(service)).rejects.toBe(error);
      expect(findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('configuration', () => {
    const newUserWithClaims = (svc: OidcUsersService, roleClaims: Record<string, unknown>) => {
      idpReturns({ email: 'new@example.com', email_verified: true, ...roleClaims });
      noUser();
      return login(svc);
    };

    it.each([
      ['a single admin value', { groups: 'admin' }, Role.admin],
      ['values separated by spaces', { groups: 'viewer vrt-admin' }, Role.admin],
      ['values separated by commas', { groups: 'viewer,admin' }, Role.admin],
      ['admin values in another case', { groups: ['VRT-Admin'] }, Role.admin],
      ['values that are only separators', { groups: ' , ' }, Role.editor],
      ['object values, which are ignored', { groups: [{ name: 'admin' }] }, Role.editor],
    ])('derives the role from %s', async (_case, roleClaims, expected) => {
      await newUserWithClaims(service, roleClaims);

      expectCreatedWith({ role: expected });
    });

    it('trims and lower-cases the configured admin values', async () => {
      await newUserWithClaims(serviceWith({ OIDC_ADMIN_VALUES: ' Ops-Team , ,42' }), { groups: ['ops-team'] });

      expectCreatedWith({ role: Role.admin });
    });

    it.each([
      ['a number', 42],
      ['a boolean', true],
    ])('compares a role claim holding %s as a string', async (_case, value) => {
      await newUserWithClaims(serviceWith({ OIDC_ADMIN_VALUES: String(value) }), { groups: [value] });

      expectCreatedWith({ role: Role.admin });
    });

    it('gives new users without an admin claim the configured default role', async () => {
      await newUserWithClaims(serviceWith({ OIDC_DEFAULT_ROLE: 'Admin' }), {});

      expectCreatedWith({ role: Role.admin });
    });
  });

  describe('non-SSO operations', () => {
    it('updates the name but never the email of an OIDC user', async () => {
      update.mockResolvedValue(user);

      const result = await service.update('1', {
        email: 'changed@example.com',
        firstName: 'New',
        lastName: 'Name',
      });

      expect(update).toHaveBeenCalledWith({ where: { id: '1' }, data: { firstName: 'New', lastName: 'Name' } });
      expect(result.token).toBe('vrt-jwt');
    });

    it('rejects password changes', async () => {
      await expect(service.changePassword(user, 'newPassword')).rejects.toThrow(
        'Password changes are disabled. Use SSO to change your password.'
      );
    });

    it('rejects password login', async () => {
      await expect(service.login({ email: 'a@b.com', password: 'x' })).rejects.toThrow('Password login is disabled.');
    });

    it('rejects user creation', async () => {
      await expect(service.create({ email: 'a@b.com', firstName: 'A', lastName: 'B', password: 'x' })).rejects.toThrow(
        'User creation is disabled.'
      );
    });
  });
});
