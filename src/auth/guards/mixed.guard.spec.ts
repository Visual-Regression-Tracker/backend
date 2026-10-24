import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiGuard } from './api.guard';
import { JwtAuthGuard } from './auth.guard';
import { MixedGuard } from './mixed.guard';

type Outcome = 'pass' | 'fail' | 'throw';

const mockFor = (outcome: Outcome) => {
  switch (outcome) {
    case 'pass':
      return jest.fn().mockResolvedValue(true);
    case 'fail':
      return jest.fn().mockResolvedValue(false);
    case 'throw':
      return jest.fn().mockRejectedValue(new UnauthorizedException());
  }
};

describe('MixedGuard', () => {
  const context = {} as ExecutionContext;

  const createGuard = (jwt: Outcome, api: Outcome) => {
    const authGuard = { canActivate: mockFor(jwt) };
    const apiGuard = { canActivate: mockFor(api) };
    const guard = new MixedGuard(apiGuard as unknown as ApiGuard, authGuard as unknown as JwtAuthGuard);
    return { guard, authGuard, apiGuard };
  };

  it.each<[Outcome, Outcome, boolean]>([
    ['pass', 'pass', true],
    ['pass', 'fail', true],
    ['pass', 'throw', true],
    ['fail', 'pass', true],
    ['fail', 'fail', false],
    ['fail', 'throw', false],
    ['throw', 'pass', true],
    ['throw', 'fail', false],
    ['throw', 'throw', false],
  ])('jwt %s + api %s resolves to %s', async (jwt, api, expected) => {
    const { guard } = createGuard(jwt, api);

    await expect(guard.canActivate(context)).resolves.toBe(expected);
  });

  // NOTE: current behavior — both guards always run, even when the JWT guard
  // has already let the request through, so an extra api-key lookup hits the
  // database on every JWT-authenticated request.
  it('always consults both guards with the same context', async () => {
    const { guard, authGuard, apiGuard } = createGuard('pass', 'fail');

    await guard.canActivate(context);

    expect(authGuard.canActivate).toHaveBeenCalledWith(context);
    expect(apiGuard.canActivate).toHaveBeenCalledWith(context);
  });

  it('consults the JWT guard before the api-key guard', async () => {
    const { guard, authGuard, apiGuard } = createGuard('fail', 'fail');

    await guard.canActivate(context);

    expect(authGuard.canActivate.mock.invocationCallOrder[0]).toBeLessThan(
      apiGuard.canActivate.mock.invocationCallOrder[0]
    );
  });

  // NOTE: current behavior — the JWT guard's result is cast, not checked, so
  // a truthy non-boolean value is passed through as-is.
  it('passes a truthy non-boolean JWT result straight through', async () => {
    const { guard, authGuard } = createGuard('fail', 'fail');
    authGuard.canActivate.mockResolvedValue('yes');

    await expect(guard.canActivate(context)).resolves.toBe('yes');
  });
});
