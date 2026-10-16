import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OidcUsersService } from './oidcusers.service';

const mockAuthorizationUrl = jest.fn();
const mockCallback = jest.fn();
const mockUserinfo = jest.fn();
const mockDiscover = jest.fn();

jest.mock('openid-client', () => ({
  Issuer: { discover: (...args: unknown[]) => mockDiscover(...args) },
  generators: {
    state: () => 'mock-state',
    codeVerifier: () => 'mock-verifier',
    codeChallenge: () => 'mock-challenge',
  },
  custom: { setHttpOptionsDefaults: jest.fn() },
}));

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

describe('OidcUsersService', () => {
  let service: OidcUsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDiscover.mockResolvedValue({
      Client: class {
        authorizationUrl = mockAuthorizationUrl;
        callback = mockCallback;
        userinfo = mockUserinfo;
      },
    });
    mockAuthorizationUrl.mockReturnValue('https://idp.example.com/authorize');
    service = new OidcUsersService(configService, prismaService, authService);
  });

  describe('getAuthorizationUrl', () => {
    it('returns the IdP url together with state and PKCE verifier', async () => {
      const result = await service.getAuthorizationUrl();

      expect(result).toEqual({
        url: 'https://idp.example.com/authorize',
        state: 'mock-state',
        codeVerifier: 'mock-verifier',
      });
      expect(mockAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'mock-state',
          code_challenge: 'mock-challenge',
          code_challenge_method: 'S256',
        })
      );
    });
  });

  describe('buildFrontendRedirect', () => {
    it('puts the token into the url fragment', () => {
      expect(service.buildFrontendRedirect('vrt-jwt')).toBe('http://localhost:8080/login#token=vrt-jwt');
    });

    it('adds an error fragment when no token is present', () => {
      expect(service.buildFrontendRedirect(undefined, 'oidc_login_failed')).toBe(
        'http://localhost:8080/login#error=oidc_login_failed'
      );
    });
  });

  describe('handleCallback', () => {
    const checks = { state: 'mock-state', codeVerifier: 'mock-verifier' };

    it('creates a new user and derives the admin role from the claims', async () => {
      mockCallback.mockResolvedValue({
        access_token: 'access-token',
        claims: () => ({
          email: 'new.user@example.com',
          given_name: 'New',
          family_name: 'User',
          groups: ['vrt-admin'],
        }),
      });
      findUnique.mockResolvedValue(null);
      create.mockImplementation(({ data }) => ({ ...user, ...data }));

      const result = await service.handleCallback({ code: 'code', state: 'mock-state' }, checks);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'new.user@example.com',
            firstName: 'New',
            lastName: 'User',
            role: Role.admin,
          }),
        })
      );
      expect(result.token).toBe('vrt-jwt');
    });

    it('falls back to the editor role when no admin claim matches', async () => {
      mockCallback.mockResolvedValue({
        claims: () => ({ email: 'plain@example.com', given_name: 'Plain', family_name: 'User', groups: ['other'] }),
      });
      findUnique.mockResolvedValue(null);
      create.mockImplementation(({ data }) => ({ ...user, ...data }));

      await service.handleCallback({ code: 'code', state: 'mock-state' }, checks);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: Role.editor }) })
      );
    });

    it('updates the role of an existing user from the claims', async () => {
      mockCallback.mockResolvedValue({
        claims: () => ({ email: 'test@example.com', groups: ['admin'] }),
      });
      findUnique.mockResolvedValue(user);
      update.mockResolvedValue({ ...user, role: Role.admin });

      const result = await service.handleCallback({ code: 'code', state: 'mock-state' }, checks);

      expect(update).toHaveBeenCalledWith({ where: { id: user.id }, data: { role: Role.admin } });
      expect(result.token).toBe('vrt-jwt');
    });

    it('throws when the email claim is missing', async () => {
      mockCallback.mockResolvedValue({
        claims: () => ({ given_name: 'No', family_name: 'Mail' }),
      });

      await expect(service.handleCallback({ code: 'code', state: 'mock-state' }, checks)).rejects.toThrow(
        'OIDC login failed.'
      );
    });

    it('throws when the callback validation fails', async () => {
      mockCallback.mockRejectedValue(new Error('state mismatch'));

      await expect(service.handleCallback({ code: 'code', state: 'wrong' }, checks)).rejects.toThrow(
        'OIDC login failed.'
      );
    });
  });

  describe('non-SSO operations', () => {
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
