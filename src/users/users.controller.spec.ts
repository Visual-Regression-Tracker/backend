import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { UserDto } from './dto/user.dto';

describe('Users Controller', () => {
  let controller: UsersController;
  let usersService: {
    isOidcEnabled: jest.Mock;
    oidcGetAuthorizationUrl: jest.Mock;
    oidcBuildFrontendRedirect: jest.Mock;
    oidcHandleCallback: jest.Mock;
    create: jest.Mock;
    login: jest.Mock;
    generateNewApiKey: jest.Mock;
    changePassword: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
    assignRole: jest.Mock;
  };
  let prismaService: { user: { findMany: jest.Mock } };
  let configService: { get: jest.Mock };

  const user: User = {
    id: '1',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    apiKey: 'api-key',
    password: 'encrypted',
    isActive: true,
    role: Role.editor,
    updatedAt: new Date(),
    createdAt: new Date(),
  };

  beforeEach(async () => {
    usersService = {
      isOidcEnabled: jest.fn(),
      oidcGetAuthorizationUrl: jest.fn(),
      oidcBuildFrontendRedirect: jest.fn(),
      oidcHandleCallback: jest.fn(),
      create: jest.fn(),
      login: jest.fn(),
      generateNewApiKey: jest.fn(),
      changePassword: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      assignRole: jest.fn(),
    };
    prismaService = { user: { findMany: jest.fn() } };
    configService = { get: jest.fn((_key: string, defaultValue?: string) => defaultValue) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns the current user', () => {
    const result = controller.me(user);
    expect(result).toBeInstanceOf(UserDto);
    expect(result.email).toBe('test@example.com');
  });

  it('reports whether OIDC is enabled', () => {
    usersService.isOidcEnabled.mockReturnValue(true);
    expect(controller.oidcEnabled()).toBe(true);
  });

  it('redirects to the frontend with an error when the state cookie is missing', async () => {
    usersService.isOidcEnabled.mockReturnValue(true);
    usersService.oidcBuildFrontendRedirect.mockReturnValue('http://localhost:8080/login#error=oidc_login_failed');
    const res = { clearCookie: jest.fn(), redirect: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };

    await controller.oidcCallback({ headers: {}, query: {} } as never, res as never);

    expect(usersService.oidcHandleCallback).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('http://localhost:8080/login#error=oidc_login_failed');
  });

  it('redirects to the frontend with an error when the state cookie is malformed', async () => {
    usersService.isOidcEnabled.mockReturnValue(true);
    usersService.oidcBuildFrontendRedirect.mockReturnValue('http://localhost:8080/login#error=oidc_login_failed');
    const res = { clearCookie: jest.fn(), redirect: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };

    await controller.oidcCallback({ headers: { cookie: 'oidc_state=%E0%A4%A' }, query: {} } as never, res as never);

    expect(usersService.oidcHandleCallback).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('http://localhost:8080/login#error=oidc_login_failed');
  });

  it('redirects to the frontend with an error when the identity provider is unreachable', async () => {
    usersService.isOidcEnabled.mockReturnValue(true);
    usersService.oidcGetAuthorizationUrl.mockRejectedValue(new Error('discovery down'));
    usersService.oidcBuildFrontendRedirect.mockReturnValue('http://localhost:8080/login#error=oidc_login_failed');
    const res = { cookie: jest.fn(), redirect: jest.fn() };

    await controller.oidcLogin(res as never);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('http://localhost:8080/login#error=oidc_login_failed');
  });

  it('returns 404 on login when OIDC is disabled', async () => {
    usersService.isOidcEnabled.mockReturnValue(false);
    const res = { cookie: jest.fn(), redirect: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };

    await controller.oidcLogin(res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(usersService.oidcGetAuthorizationUrl).not.toHaveBeenCalled();
  });

  it('redirects to the identity provider and stores the PKCE state cookie', async () => {
    usersService.isOidcEnabled.mockReturnValue(true);
    usersService.oidcGetAuthorizationUrl.mockResolvedValue({
      url: 'https://idp.example.com/authorize',
      state: 'state',
      codeVerifier: 'verifier',
    });
    const res = { cookie: jest.fn(), redirect: jest.fn() };

    await controller.oidcLogin(res as never);

    expect(res.cookie).toHaveBeenCalledWith(
      'oidc_state',
      'state.verifier',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' })
    );
    expect(res.redirect).toHaveBeenCalledWith('https://idp.example.com/authorize');
  });

  it('redirects to the frontend with the token after a successful callback', async () => {
    usersService.isOidcEnabled.mockReturnValue(true);
    usersService.oidcHandleCallback.mockResolvedValue({ token: 'jwt' });
    usersService.oidcBuildFrontendRedirect.mockReturnValue('http://localhost:8080/login#token=jwt');
    const res = { clearCookie: jest.fn(), redirect: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
    const req = {
      headers: { cookie: 'oidc_state=state.verifier' },
      query: { code: 'code', state: 'state', repeated: ['a', 'b'] },
    };

    await controller.oidcCallback(req as never, res as never);

    expect(usersService.oidcHandleCallback).toHaveBeenCalledWith(
      { code: 'code', state: 'state' },
      { state: 'state', codeVerifier: 'verifier' }
    );
    expect(res.redirect).toHaveBeenCalledWith('http://localhost:8080/login#token=jwt');
  });

  it('returns 404 on the callback when OIDC is disabled', async () => {
    usersService.isOidcEnabled.mockReturnValue(false);
    const res = { clearCookie: jest.fn(), redirect: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };

    await controller.oidcCallback({ headers: {}, query: {} } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalled();
  });

  describe('OIDC cookie handling', () => {
    const okResponse = () => ({
      clearCookie: jest.fn(),
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    });

    beforeEach(() => {
      usersService.isOidcEnabled.mockReturnValue(true);
      usersService.oidcBuildFrontendRedirect.mockImplementation((token?: string, error?: string) =>
        token ? `front#token=${token}` : `front#error=${error}`
      );
    });

    it('finds the state cookie among other cookies and decodes it', async () => {
      usersService.oidcHandleCallback.mockResolvedValue({ token: 'jwt' });
      const res = okResponse();

      await controller.oidcCallback(
        { headers: { cookie: 'a=1; oidc_state=st%2Ea.ver=ifier; b=2' }, query: {} } as never,
        res as never
      );

      // "=" inside the value is kept; after decoding it is split on every "." and
      // only the first two parts are used.
      // NOTE: current behavior — a verifier containing "." (allowed by RFC 7636) would be truncated
      expect(usersService.oidcHandleCallback).toHaveBeenCalledWith({}, { state: 'st', codeVerifier: 'a' });
      expect(res.clearCookie).toHaveBeenCalledWith('oidc_state', { path: '/' });
      expect(res.redirect).toHaveBeenCalledWith('front#token=jwt');
    });

    it('fails the callback when other cookies are present but not the state cookie', async () => {
      const res = okResponse();

      await controller.oidcCallback({ headers: { cookie: 'a=1; b=2' }, query: {} } as never, res as never);

      expect(usersService.oidcHandleCallback).not.toHaveBeenCalled();
      expect(usersService.oidcBuildFrontendRedirect).toHaveBeenCalledWith(undefined, 'oidc_login_failed');
      expect(res.clearCookie).toHaveBeenCalledWith('oidc_state', { path: '/' });
      expect(res.redirect).toHaveBeenCalledWith('front#error=oidc_login_failed');
    });

    it('fails the callback when the identity provider rejects the code', async () => {
      usersService.oidcHandleCallback.mockRejectedValue(new Error('invalid_grant'));
      const res = okResponse();

      await controller.oidcCallback(
        { headers: { cookie: 'oidc_state=state.verifier' }, query: { code: 'c' } } as never,
        res as never
      );

      expect(res.clearCookie).toHaveBeenCalledWith('oidc_state', { path: '/' });
      expect(res.redirect).toHaveBeenCalledWith('front#error=oidc_login_failed');
    });

    it('fails the callback when the identity provider rejects with a non-Error', async () => {
      usersService.oidcHandleCallback.mockRejectedValue('plain failure');
      const res = okResponse();

      await controller.oidcCallback(
        { headers: { cookie: 'oidc_state=state.verifier' }, query: {} } as never,
        res as never
      );

      expect(res.redirect).toHaveBeenCalledWith('front#error=oidc_login_failed');
    });

    it.each([
      ['https://vrt.example.com/callback', true],
      ['http://localhost:4200/callback', false],
    ])('marks the state cookie secure based on OIDC_REDIRECT_URI %s', async (redirectUri, secure) => {
      configService.get.mockImplementation((key: string, defaultValue?: string) =>
        key === 'OIDC_REDIRECT_URI' ? redirectUri : defaultValue
      );
      usersService.oidcGetAuthorizationUrl.mockResolvedValue({ url: 'idp', state: 's', codeVerifier: 'v' });
      const res = { cookie: jest.fn(), redirect: jest.fn() };

      await controller.oidcLogin(res as never);

      expect(configService.get).toHaveBeenCalledWith('OIDC_REDIRECT_URI', '');
      expect(res.cookie).toHaveBeenCalledWith('oidc_state', 's.v', {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: 600000,
        path: '/',
      });
    });

    it('redirects to the login page when the authorization url rejects with a non-Error', async () => {
      usersService.oidcGetAuthorizationUrl.mockRejectedValue('plain failure');
      const res = { cookie: jest.fn(), redirect: jest.fn() };

      await controller.oidcLogin(res as never);

      expect(res.redirect).toHaveBeenCalledWith('front#error=oidc_login_failed');
    });
  });

  describe('account handlers', () => {
    it('registers a user', async () => {
      const dto = { email: 'new@example.com', firstName: 'N', lastName: 'U', password: 'secret' };
      usersService.create.mockResolvedValue('registered');

      await expect(controller.register(dto)).resolves.toBe('registered');
      expect(usersService.create).toHaveBeenCalledWith(dto);
    });

    it('logs a user in', async () => {
      const dto = { email: 'test@example.com', password: 'secret' };
      usersService.login.mockResolvedValue('logged in');

      await expect(controller.login(dto)).resolves.toBe('logged in');
      expect(usersService.login).toHaveBeenCalledWith(dto);
    });

    it('generates a new api key for the current user', async () => {
      usersService.generateNewApiKey.mockResolvedValue('new-key');

      await expect(controller.generateNewApiKey(user)).resolves.toBe('new-key');
      expect(usersService.generateNewApiKey).toHaveBeenCalledWith(user);
    });

    it('changes the password of the current user', async () => {
      usersService.changePassword.mockResolvedValue(true);

      await expect(controller.changePassword(user, 'new password')).resolves.toBe(true);
      expect(usersService.changePassword).toHaveBeenCalledWith(user, 'new password');
    });

    it('updates the current user by id', async () => {
      const dto = { email: 'changed@example.com', firstName: 'C', lastName: 'U' };
      usersService.update.mockResolvedValue('updated');

      await expect(controller.update(user, dto)).resolves.toBe('updated');
      expect(usersService.update).toHaveBeenCalledWith(user.id, dto);
    });
  });

  describe('admin handlers', () => {
    it('lists every user as a UserDto without the password', async () => {
      prismaService.user.findMany.mockResolvedValue([user, { ...user, id: '2', email: 'other@example.com' }]);

      const result = await controller.userList();

      expect(prismaService.user.findMany).toHaveBeenCalledWith();
      expect(result).toEqual([new UserDto(user), new UserDto({ ...user, id: '2', email: 'other@example.com' })]);
      expect(result[0]).not.toHaveProperty('password');
    });

    it('deletes the users in one go', async () => {
      usersService.deleteMany.mockResolvedValueOnce(undefined);

      await expect(controller.delete(['1', '2', '3'])).resolves.toBeUndefined();

      expect(usersService.deleteMany).toHaveBeenCalledWith(['1', '2', '3']);
    });

    it('passes a failure on', async () => {
      usersService.deleteMany.mockRejectedValueOnce(new Error('not found'));

      await expect(controller.delete(['1', '2', '3'])).rejects.toThrow('not found');
    });

    it('assigns a role', async () => {
      const dto = { id: '1', role: Role.admin };
      usersService.assignRole.mockResolvedValue('assigned');

      await expect(controller.assignRole(dto)).resolves.toBe('assigned');
      expect(usersService.assignRole).toHaveBeenCalledWith(dto);
    });
  });
});
