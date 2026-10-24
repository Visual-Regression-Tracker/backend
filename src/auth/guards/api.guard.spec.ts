import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiGuard } from './api.guard';

describe('ApiGuard', () => {
  let prismaService: { user: { findUnique: jest.Mock } };
  let guard: ApiGuard;

  const context = (apiKey?: string) => {
    const request = { header: jest.fn().mockReturnValue(apiKey) };
    const executionContext = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { executionContext, request };
  };

  beforeEach(() => {
    prismaService = { user: { findUnique: jest.fn() } };
    guard = new ApiGuard(prismaService as unknown as PrismaService);
  });

  it('allows a request whose apiKey header belongs to a user', async () => {
    prismaService.user.findUnique.mockResolvedValue({ id: '1' } as User);
    const { executionContext, request } = context('valid-key');

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(request.header).toHaveBeenCalledWith('apiKey');
    expect(prismaService.user.findUnique).toHaveBeenCalledWith({ where: { apiKey: 'valid-key' } });
  });

  it('rejects a request whose apiKey does not belong to a user', async () => {
    prismaService.user.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(context('unknown-key').executionContext)).resolves.toBe(false);
  });

  // NOTE: current behavior — a missing header is still sent to Prisma as
  // `apiKey: undefined`; it is the lookup failing (or returning nothing) that
  // rejects the request, not a check in the guard.
  it('still queries the database when the apiKey header is missing', async () => {
    prismaService.user.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(context(undefined).executionContext)).resolves.toBe(false);
    expect(prismaService.user.findUnique).toHaveBeenCalledWith({ where: { apiKey: undefined } });
  });

  it('turns a failing lookup into an UnauthorizedException', async () => {
    prismaService.user.findUnique.mockRejectedValue(new Error('Argument where of type UserWhereUniqueInput needs'));

    await expect(guard.canActivate(context(undefined).executionContext)).rejects.toThrow(UnauthorizedException);
  });
});
