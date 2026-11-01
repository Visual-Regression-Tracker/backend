import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../shared/roles.decorator';
import { ApiGuard } from './api.guard';
import { RoleGuard } from './role.guard';

const userWithRole = (role: Role): User => ({ id: '1', role }) as User;

describe('RoleGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let prismaService: { user: { findUnique: jest.Mock } };
  let guard: RoleGuard;

  const context = (user?: User): ExecutionContext => {
    const request = { user };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    prismaService = { user: { findUnique: jest.fn() } };
    guard = new RoleGuard(reflector as unknown as Reflector);
  });

  it('allows the request when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(context())).toBe(true);
  });

  it.each<[string, Role[], Role | undefined, boolean]>([
    ['allows an admin on an admin-only endpoint', [Role.admin], Role.admin, true],
    ['rejects an editor on an admin-only endpoint', [Role.admin], Role.editor, false],
    ['allows an editor where editor is permitted', [Role.admin, Role.editor], Role.editor, true],
    ['rejects a guest where only admin and editor are permitted', [Role.admin, Role.editor], Role.guest, false],
    ['rejects when no user was authenticated', [Role.admin], undefined, false],
  ])('%s', (_name, required, role, allowed) => {
    reflector.getAllAndOverride.mockReturnValue(required);

    expect(guard.canActivate(context(role && userWithRole(role)))).toBe(allowed);
  });

  describe('with the @Roles metadata', () => {
    @Roles(Role.admin)
    class AdminController {
      inherited(): void {}

      @Roles(Role.editor)
      overridden(): void {}
    }

    const decoratedContext = (handler: () => void, user: User): ExecutionContext =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user, header: jest.fn() }) }),
        getHandler: () => handler,
        getClass: () => AdminController,
      }) as unknown as ExecutionContext;

    beforeEach(() => {
      guard = new RoleGuard(new Reflector());
    });

    it('applies the roles declared on the controller class', () => {
      const handler = AdminController.prototype.inherited;

      expect(guard.canActivate(decoratedContext(handler, userWithRole(Role.editor)))).toBe(false);
      expect(guard.canActivate(decoratedContext(handler, userWithRole(Role.admin)))).toBe(true);
    });

    it('lets the roles on the handler override the class', () => {
      const handler = AdminController.prototype.overridden;

      expect(guard.canActivate(decoratedContext(handler, userWithRole(Role.editor)))).toBe(true);
      expect(guard.canActivate(decoratedContext(handler, userWithRole(Role.admin)))).toBe(false);
    });
  });

  it('uses the user stored by ApiGuard without a second lookup', async () => {
    reflector.getAllAndOverride.mockReturnValue([Role.admin]);
    prismaService.user.findUnique.mockResolvedValue(userWithRole(Role.admin));
    const request = { header: jest.fn().mockReturnValue('admin-key') };
    const shared = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    await expect(new ApiGuard(prismaService as unknown as PrismaService).canActivate(shared)).resolves.toBe(true);
    expect(guard.canActivate(shared)).toBe(true);

    expect(prismaService.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
