import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { FilesToBodyInterceptor, FileToBodyInterceptor } from './fite-to-body.interceptor';

const file = (fieldname: string, originalname = `${fieldname}.png`) =>
  ({ fieldname, originalname }) as Express.Multer.File;

const contextWith = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

const handler = (): CallHandler & { handle: jest.Mock } => ({ handle: jest.fn().mockReturnValue(of('handled')) });

describe('FilesToBodyInterceptor', () => {
  const interceptor = new FilesToBodyInterceptor();

  it('groups the uploaded files into body arrays keyed by field name', async () => {
    const [a1, a2, b1] = [file('a', 'a1.png'), file('a', 'a2.png'), file('b')];
    const request = { body: { name: 'x' }, files: [a1, a2, b1] };
    const next = handler();

    const result = interceptor.intercept(contextWith(request), next);

    expect(request.body).toEqual({ name: 'x', a: [a1, a2], b: [b1] });
    expect(next.handle).toHaveBeenCalledTimes(1);
    await expect(lastValueFrom(result)).resolves.toBe('handled');
  });

  it('appends to an array the body already has for that field', () => {
    const existing = file('a', 'existing.png');
    const added = file('a', 'added.png');
    const request = { body: { a: [existing] }, files: [added] };

    interceptor.intercept(contextWith(request), handler());

    expect(request.body.a).toEqual([existing, added]);
  });

  // NOTE: current behavior — a non-array body value under the same field name
  // has `.push` called on it, so a plain string value makes the interceptor throw.
  it('throws when the body already has a non-array value for the field', () => {
    const request = { body: { a: 'text' }, files: [file('a')] };

    expect(() => interceptor.intercept(contextWith(request), handler())).toThrow(TypeError);
  });

  it.each([
    ['no body', { files: [file('a')] }],
    ['no files', { body: {} }],
    ['an empty files array', { body: {}, files: [] }],
    ['files given as a field map', { body: {}, files: { a: [file('a')] } }],
  ])('leaves the request untouched with %s', (_label, request) => {
    const before = JSON.parse(JSON.stringify(request));
    const next = handler();

    interceptor.intercept(contextWith(request), next);

    expect(JSON.parse(JSON.stringify(request))).toEqual(before);
    expect(next.handle).toHaveBeenCalledTimes(1);
  });
});

describe('FileToBodyInterceptor', () => {
  const interceptor = new FileToBodyInterceptor();

  it('copies the single uploaded file into the body under its field name', async () => {
    const image = file('image');
    const request = { body: { name: 'x' }, file: image };
    const next = handler();

    const result = interceptor.intercept(contextWith(request), next);

    expect(request.body).toEqual({ name: 'x', image });
    await expect(lastValueFrom(result)).resolves.toBe('handled');
  });

  it('keeps a body value that already exists for the field', () => {
    const request = { body: { image: 'from-body' }, file: file('image') };

    interceptor.intercept(contextWith(request), handler());

    expect(request.body.image).toBe('from-body');
  });

  it.each([
    ['no body', { file: file('image') }],
    ['no file', { body: {} }],
    ['a file without a field name', { body: {}, file: { originalname: 'x.png' } }],
  ])('leaves the request untouched with %s', (_label, request) => {
    const before = JSON.parse(JSON.stringify(request));
    const next = handler();

    interceptor.intercept(contextWith(request), next);

    expect(JSON.parse(JSON.stringify(request))).toEqual(before);
    expect(next.handle).toHaveBeenCalledTimes(1);
  });
});
