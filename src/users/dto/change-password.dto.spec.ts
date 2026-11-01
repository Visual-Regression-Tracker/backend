import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from './change-password.dto';

const failedProperties = async (body: object): Promise<string[]> =>
  (await validate(plainToInstance(ChangePasswordDto, body))).map((error) => error.property);

describe('ChangePasswordDto', () => {
  it.each([
    ['a missing password', {}],
    ['an empty password', { password: '' }],
    ['a password that is not a string', { password: 1 }],
  ])('rejects %s', async (_name, body) => {
    expect(await failedProperties(body)).toEqual(['password']);
  });

  it('accepts a non-empty password', async () => {
    expect(await failedProperties({ password: 'x' })).toEqual([]);
  });
});
