import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RoleGuard } from './role.guard';

const userWithRole = (role: Role): User => ({ id: '1', role }) as User;

describe('RoleGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let prismaService: { user: { findUnique: jest.Mock } };
  let guard: RoleGuard;

  const context = (user?: User, apiKey?: string): ExecutionContext => {
    const request = {
      user,
      header: jest.fn().mockReturnValue(apiKey),
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    prismaService = { user: { findUnique: jest.fn() } };
    guard = new RoleGuard(prismaService as unknown as PrismaService, reflector as unknown as Reflector);
  });

  it('allows the request when no roles are required', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(context())).resolves.toBe(true);
  });

  it('allows an admin on an admin-only endpoint', async () => {
    reflector.getAllAndOverride.mockReturnValue([Role.admin]);

    await expect(guard.canActivate(context(userWithRole(Role.admin)))).resolves.toBe(true);
  });

  it('rejects an editor on an admin-only endpoint', async () => {
    reflector.getAllAndOverride.mockReturnValue([Role.admin]);

    await expect(guard.canActivate(context(userWithRole(Role.editor)))).resolves.toBe(false);
  });

  it('allows an editor where editor is permitted', async () => {
    reflector.getAllAndOverride.mockReturnValue([Role.admin, Role.editor]);

    await expect(guard.canActivate(context(userWithRole(Role.editor)))).resolves.toBe(true);
  });

  it('rejects a guest where only admin and editor are permitted', async () => {
    reflector.getAllAndOverride.mockReturnValue([Role.admin, Role.editor]);

    await expect(guard.canActivate(context(userWithRole(Role.guest)))).resolves.toBe(false);
  });

  it('rejects when neither a user nor an api key is present', async () => {
    reflector.getAllAndOverride.mockReturnValue([Role.admin]);

    await expect(guard.canActivate(context())).resolves.toBe(false);
    expect(prismaService.user.findUnique).not.toHaveBeenCalled();
  });

  it('resolves the user from the apiKey header when request.user is absent', async () => {
    reflector.getAllAndOverride.mockReturnValue([Role.admin]);
    prismaService.user.findUnique.mockResolvedValue(userWithRole(Role.admin));

    await expect(guard.canActivate(context(undefined, 'api-key'))).resolves.toBe(true);
    expect(prismaService.user.findUnique).toHaveBeenCalledWith({ where: { apiKey: 'api-key' } });
  });

  it('rejects when the api key does not belong to a user', async () => {
    reflector.getAllAndOverride.mockReturnValue([Role.admin]);
    prismaService.user.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(context(undefined, 'unknown'))).resolves.toBe(false);
  });
});
