import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { UserDto, toUserSummary } from './dto/user.dto';
import { ForbiddenException } from '@nestjs/common';

describe('Users Controller', () => {
  let controller: UsersController;
  let usersService: {
    isOidcEnabled: jest.Mock;
    isRegistrationAllowedByConfig: jest.Mock;
    isRegistrationEnabled: jest.Mock;
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
      isRegistrationAllowedByConfig: jest.fn().mockReturnValue(true),
      isRegistrationEnabled: jest.fn(),
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

  it('returns the current user', () => {
    const result = controller.me(user);
    expect(result).toBeInstanceOf(UserDto);
    expect(result.email).toBe('test@example.com');
  });

  it('reports whether OIDC is enabled', () => {
    usersService.isOidcEnabled.mockReturnValue(true);
    expect(controller.oidcEnabled()).toBe(true);
  });

  describe('OIDC', () => {
    const mockRes = () => ({
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    });
    const callback = (res: ReturnType<typeof mockRes>, headers: object = {}, query: object = {}) =>
      controller.oidcCallback({ headers, query } as never, res as never);
    const stateCookie = { cookie: 'oidc_state=state.verifier' };

    beforeEach(() => {
      usersService.isOidcEnabled.mockReturnValue(true);
      usersService.oidcBuildFrontendRedirect.mockImplementation((token?: string) =>
        token ? `front#token=${token}` : 'front#error=oidc_login_failed'
      );
    });

    it.each([
      ['is missing', {}],
      ['is missing among other cookies', { cookie: 'a=1; b=2' }],
      ['is malformed', { cookie: 'oidc_state=%E0%A4%A' }],
    ])('redirects to the frontend with an error when the state cookie %s', async (_case, headers) => {
      const res = mockRes();

      await callback(res, headers);

      expect(usersService.oidcHandleCallback).not.toHaveBeenCalled();
      expect(usersService.oidcBuildFrontendRedirect).toHaveBeenCalledWith();
      expect(res.clearCookie).toHaveBeenCalledWith('oidc_state', { path: '/' });
      expect(res.redirect).toHaveBeenCalledWith('front#error=oidc_login_failed');
    });

    it.each([new Error('discovery down'), 'plain failure'])(
      'redirects to the frontend with an error when the authorization url rejects with %j',
      async (failure) => {
        usersService.oidcGetAuthorizationUrl.mockRejectedValue(failure);
        const res = mockRes();

        await controller.oidcLogin(res as never);

        expect(res.cookie).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('front#error=oidc_login_failed');
      }
    );

    it('returns 404 on login when OIDC is disabled', async () => {
      usersService.isOidcEnabled.mockReturnValue(false);
      const res = mockRes();

      await controller.oidcLogin(res as never);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(usersService.oidcGetAuthorizationUrl).not.toHaveBeenCalled();
    });

    it('redirects to the identity provider and stores the PKCE state cookie', async () => {
      usersService.oidcGetAuthorizationUrl.mockResolvedValue({
        url: 'https://idp.example.com/authorize',
        state: 'state',
        codeVerifier: 'verifier',
      });
      const res = mockRes();

      await controller.oidcLogin(res as never);

      expect(res.cookie).toHaveBeenCalledWith(
        'oidc_state',
        'state.verifier',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax' })
      );
      expect(res.redirect).toHaveBeenCalledWith('https://idp.example.com/authorize');
    });

    it('redirects to the frontend with the token after a successful callback', async () => {
      usersService.oidcHandleCallback.mockResolvedValue({ token: 'jwt' });
      const res = mockRes();

      await callback(res, stateCookie, { code: 'code', state: 'state', repeated: ['a', 'b'] });

      expect(usersService.oidcHandleCallback).toHaveBeenCalledWith(
        { code: 'code', state: 'state' },
        { state: 'state', codeVerifier: 'verifier' }
      );
      expect(res.redirect).toHaveBeenCalledWith('front#token=jwt');
    });

    it('returns 404 on the callback when OIDC is disabled', async () => {
      usersService.isOidcEnabled.mockReturnValue(false);
      const res = mockRes();

      await callback(res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalled();
    });

    it('finds the state cookie among other cookies and splits it at the first dot (generated verifiers are base64url, without dots)', async () => {
      usersService.oidcHandleCallback.mockResolvedValue({ token: 'jwt' });
      const res = mockRes();

      await callback(res, { cookie: 'a=1; oidc_state=st%2Ea.ver=ifier; b=2' });

      expect(usersService.oidcHandleCallback).toHaveBeenCalledWith({}, { state: 'st', codeVerifier: 'a' });
      expect(res.clearCookie).toHaveBeenCalledWith('oidc_state', { path: '/' });
      expect(res.redirect).toHaveBeenCalledWith('front#token=jwt');
    });

    it.each([new Error('invalid_grant'), 'plain failure'])(
      'fails the callback when the identity provider rejects with %j',
      async (failure) => {
        usersService.oidcHandleCallback.mockRejectedValue(failure);
        const res = mockRes();

        await callback(res, stateCookie, { code: 'c' });

        expect(res.clearCookie).toHaveBeenCalledWith('oidc_state', { path: '/' });
        expect(res.redirect).toHaveBeenCalledWith('front#error=oidc_login_failed');
      }
    );

    it.each([
      ['https://vrt.example.com/callback', true],
      ['http://localhost:4200/callback', false],
    ])('marks the state cookie secure based on OIDC_REDIRECT_URI %s', async (redirectUri, secure) => {
      configService.get.mockImplementation((key: string, defaultValue?: string) =>
        key === 'OIDC_REDIRECT_URI' ? redirectUri : defaultValue
      );
      usersService.oidcGetAuthorizationUrl.mockResolvedValue({ url: 'idp', state: 's', codeVerifier: 'v' });
      const res = mockRes();

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
  });

  describe('account handlers', () => {
    it('registers a user', async () => {
      const dto = { email: 'new@example.com', firstName: 'N', lastName: 'U', password: 'secret' };
      usersService.create.mockResolvedValue('registered');

      await expect(controller.register(dto)).resolves.toBe('registered');
      expect(usersService.create).toHaveBeenCalledWith(dto);
    });

    it('refuses to register a user when registration is switched off', () => {
      usersService.isRegistrationAllowedByConfig.mockReturnValue(false);

      expect(() =>
        controller.register({ email: 'new@example.com', firstName: 'N', lastName: 'U', password: 'secret' })
      ).toThrow(ForbiddenException);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('reports whether registration is enabled', () => {
      usersService.isRegistrationEnabled.mockReturnValue(false);

      expect(controller.registrationEnabled()).toBe(false);
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

      await expect(controller.changePassword(user, { password: 'new password' })).resolves.toBe(true);
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
    it('lists every user as a summary without the password and the api key', async () => {
      const other = { ...user, id: '2', email: 'other@example.com' };
      prismaService.user.findMany.mockResolvedValue([user, other]);

      const result = await controller.userList();

      expect(prismaService.user.findMany).toHaveBeenCalledWith();
      expect(result).toEqual([toUserSummary(user), toUserSummary(other)]);
      for (const summary of result) {
        expect(summary).not.toHaveProperty('password');
        expect(summary).not.toHaveProperty('apiKey');
      }
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
