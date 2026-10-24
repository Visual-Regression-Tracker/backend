import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';

// a param decorator only exposes its factory through the route metadata
const getFactory = () => {
  class Controller {
    handler(@CurrentUser() _user: unknown) {}
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Controller, 'handler');
  return args[Object.keys(args)[0]].factory as (data: unknown, ctx: ExecutionContext) => unknown;
};

const contextWith = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('CurrentUser', () => {
  it('returns the user that authentication attached to the request', () => {
    const user = { id: 'user-id', email: 'user@example.com' };

    expect(getFactory()(undefined, contextWith({ user }))).toBe(user);
  });

  it('returns undefined for an unauthenticated request', () => {
    expect(getFactory()(undefined, contextWith({}))).toBeUndefined();
  });

  it('ignores the decorator data', () => {
    const user = { id: 'user-id' };

    expect(getFactory()('email', contextWith({ user }))).toBe(user);
  });
});
