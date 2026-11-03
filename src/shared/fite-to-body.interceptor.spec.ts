import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { FileToBodyInterceptor } from './fite-to-body.interceptor';

const file = (fieldname: string, originalname = `${fieldname}.png`) =>
  ({ fieldname, originalname }) as Express.Multer.File;

const contextWith = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

const handler = (): CallHandler & { handle: jest.Mock } => ({ handle: jest.fn().mockReturnValue(of('handled')) });

const expectUntouched = (interceptor: { intercept: FileToBodyInterceptor['intercept'] }, request: object) => {
  const before = JSON.parse(JSON.stringify(request));
  const next = handler();

  interceptor.intercept(contextWith(request), next);

  expect(JSON.parse(JSON.stringify(request))).toEqual(before);
  expect(next.handle).toHaveBeenCalledTimes(1);
};

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
    expectUntouched(interceptor, request);
  });
});
