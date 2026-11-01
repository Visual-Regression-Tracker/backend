import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IgnoreAreaDto } from './ignore-area.dto';

const area = { x: 1, y: 2, width: 3, height: 4 };

const failedProperties = async (dto: object): Promise<string[]> =>
  (await validate(dto)).map((error) => error.property).sort();

describe('IgnoreAreaDto', () => {
  it('accepts fractional and negative coordinates within the bounds', async () => {
    const dto = plainToInstance(IgnoreAreaDto, { x: -10.5, y: 0.25, width: 3.3, height: 4 });

    expect(await failedProperties(dto)).toEqual([]);
  });

  it('rejects x or y beyond a million either way', async () => {
    expect(await failedProperties(plainToInstance(IgnoreAreaDto, { ...area, x: -1e6 - 1 }))).toEqual(['x']);
    expect(await failedProperties(plainToInstance(IgnoreAreaDto, { ...area, y: 1e6 + 1 }))).toEqual(['y']);
  });

  it('does not bound the size', async () => {
    const dto = plainToInstance(IgnoreAreaDto, { ...area, width: 1e9, height: -1e9 });

    expect(await failedProperties(dto)).toEqual([]);
  });

  it.each([['abc'], [5]])('keeps the id the frontend sends (%p), whatever its type', async (id) => {
    const dto = plainToInstance(IgnoreAreaDto, { ...area, id });

    expect(await validate(dto, { whitelist: true })).toEqual([]);
    expect(dto.id).toBe(id);
  });

  it('does not require the id', async () => {
    expect(await failedProperties(plainToInstance(IgnoreAreaDto, area))).toEqual([]);
  });
});
