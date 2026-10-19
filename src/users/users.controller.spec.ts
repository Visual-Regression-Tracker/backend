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
  };

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
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: PrismaService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn((_key: string, defaultValue?: string) => defaultValue) } },
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

  it('redirects to the identity provider and stores the PKCE state cookie', async () => {
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
});
