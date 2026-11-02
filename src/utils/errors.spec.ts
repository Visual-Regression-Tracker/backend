import { messageOf } from './errors';

describe('messageOf', () => {
  it.each([
    ['an error', new Error('boom'), 'boom'],
    ['an error-like object', { message: 'from another realm' }, 'from another realm'],
    ['a string', 'plain failure', 'plain failure'],
    ['null', null, 'null'],
  ])('reads the message of %s', (_case, error, expected) => {
    expect(messageOf(error)).toBe(expected);
  });
});
