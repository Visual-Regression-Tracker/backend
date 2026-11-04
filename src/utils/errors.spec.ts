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

  it('appends the message of the cause', () => {
    const error = new TypeError('fetch failed', { cause: new Error('self-signed certificate') });

    expect(messageOf(error)).toBe('fetch failed (cause: self-signed certificate)');
  });

  it('follows nested causes', () => {
    const error = new Error('a', { cause: new Error('b', { cause: 'c' }) });

    expect(messageOf(error)).toBe('a (cause: b (cause: c))');
  });
});
