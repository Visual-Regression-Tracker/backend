import { IsString } from 'class-validator';
import { GlobalValidationPipe, ValidationOptions } from './validation';

class Plain {
  @IsString()
  a!: string;

  b?: string;
}

@ValidationOptions({ forbidNonWhitelisted: true, transform: true })
class Strict {
  @IsString()
  a!: string;
}

class StrictChild extends Strict {}

describe('GlobalValidationPipe', () => {
  const pipe = new GlobalValidationPipe();

  it('drops properties without a validator and keeps the declared ones', async () => {
    expect(await pipe.transform({ a: 'x', b: 'y' }, { type: 'body', metatype: Plain })).toEqual({ a: 'x' });
  });

  it('still rejects an invalid value', async () => {
    await expect(pipe.transform({ a: 1 }, { type: 'body', metatype: Plain })).rejects.toThrow();
  });

  describe('@ValidationOptions', () => {
    it('rejects undeclared fields when the DTO says so', async () => {
      await expect(pipe.transform({ a: 'x', b: 'y' }, { type: 'body', metatype: Strict })).rejects.toThrow();
    });

    it('still whitelists beside the declared options and applies them', async () => {
      const result = await pipe.transform({ a: 'x' }, { type: 'body', metatype: Strict });
      expect(result).toBeInstanceOf(Strict);
      expect(result).toEqual({ a: 'x' });
    });

    it('applies to a DTO that extends the decorated one', async () => {
      await expect(pipe.transform({ a: 'x', b: 'y' }, { type: 'body', metatype: StrictChild })).rejects.toThrow();
    });
  });

  it('passes a body without a metatype through the default whitelist pipe', async () => {
    const body = { a: 1 };
    expect(await pipe.transform(body, { type: 'body' })).toBe(body);
  });

  it.each([
    ['an array', Array, [1, 'a']],
    ['a primitive', String, 'text'],
  ])('leaves %s alone', async (_name, metatype, value) => {
    expect(await pipe.transform(value, { type: 'body', metatype })).toBe(value);
  });
});
