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
    prismaService.user.findUnique.mockResolvedValue({ id: '1' });
    const { executionContext, request } = context('valid-key');

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(request.header).toHaveBeenCalledWith('apiKey');
    expect(prismaService.user.findUnique).toHaveBeenCalledWith({ where: { apiKey: 'valid-key' } });
  });

  it('rejects a request whose apiKey does not belong to a user', async () => {
    prismaService.user.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(context('unknown-key').executionContext)).resolves.toBe(false);
  });

  it('answers 401 without a database query when the apiKey header is missing', async () => {
    await expect(guard.canActivate(context(undefined).executionContext)).rejects.toThrow(UnauthorizedException);

    expect(prismaService.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an empty apiKey header with false, as before, without a database query', async () => {
    await expect(guard.canActivate(context('').executionContext)).resolves.toBe(false);

    expect(prismaService.user.findUnique).not.toHaveBeenCalled();
  });

  it('stores the user on the request', async () => {
    const found = { id: '1' } as User;
    prismaService.user.findUnique.mockResolvedValue(found);
    const { executionContext, request } = context('valid-key');

    await guard.canActivate(executionContext);

    expect((request as { user?: User }).user).toBe(found);
  });

  it('leaves the request without a user for an unknown key', async () => {
    prismaService.user.findUnique.mockResolvedValue(null);
    const { executionContext, request } = context('unknown-key');

    await guard.canActivate(executionContext);

    expect((request as { user?: User }).user).toBeUndefined();
  });

  it('turns a failing lookup into an UnauthorizedException', async () => {
    prismaService.user.findUnique.mockRejectedValue(new Error('connection lost'));

    await expect(guard.canActivate(context('some-key').executionContext)).rejects.toThrow(UnauthorizedException);
  });
});
