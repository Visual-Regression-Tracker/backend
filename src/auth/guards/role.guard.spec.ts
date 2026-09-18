import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, User } from '@prisma/client';
import { RoleGuard } from './role.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../shared/roles.decorator';

const userWithRole = (role: Role): User => ({
  id: 'ff5c3e6e-2b3c-4c2e-9b1b-5f0f8f6b1f9a',
  email: 'user@example.com',
  password: 'hash',
  firstName: 'Test',
  lastName: 'User',
  apiKey: 'api-key',
  isActive: true,
  role,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const handlerRequiring = (...roles: Role[]) => {
  const handler = () => undefined;
  if (roles.length > 0) {
    Roles(...roles)(handler);
  }
  return handler;
};

const contextFor = (handler: () => void, request: unknown): ExecutionContext =>
  ({
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('RoleGuard', () => {
  let guard: RoleGuard;
  let findUnique: jest.Mock;

  beforeEach(async () => {
    findUnique = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [RoleGuard, Reflector, { provide: PrismaService, useValue: { user: { findUnique } } }],
    }).compile();

    guard = module.get<RoleGuard>(RoleGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('allows a handler that declares no roles', async () => {
    const context = contextFor(handlerRequiring(), { user: userWithRole(Role.guest) });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([
    [Role.admin, [Role.admin], true],
    [Role.editor, [Role.admin], false],
    [Role.guest, [Role.admin], false],
    [Role.admin, [Role.admin, Role.editor], true],
    [Role.editor, [Role.admin, Role.editor], true],
    [Role.guest, [Role.admin, Role.editor], false],
  ])('%s user against %s handler resolves to %s', async (role, required, expected) => {
    const context = contextFor(handlerRequiring(...required), { user: userWithRole(role) });

    await expect(guard.canActivate(context)).resolves.toBe(expected);
  });

  it('denies an editor holding an apiKey on an admin only handler', async () => {
    findUnique.mockResolvedValueOnce(userWithRole(Role.editor));
    const context = contextFor(handlerRequiring(Role.admin), {
      header: () => 'api-key',
    });

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledWith({ where: { apiKey: 'api-key' } });
  });

  it('allows an admin holding an apiKey on an admin only handler', async () => {
    findUnique.mockResolvedValueOnce(userWithRole(Role.admin));
    const context = contextFor(handlerRequiring(Role.admin), {
      header: () => 'api-key',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('denies a request whose user cannot be resolved', async () => {
    findUnique.mockResolvedValueOnce(null);
    const context = contextFor(handlerRequiring(Role.admin), {
      header: () => 'unknown-key',
    });

    await expect(guard.canActivate(context)).resolves.toBe(false);
  });
});
