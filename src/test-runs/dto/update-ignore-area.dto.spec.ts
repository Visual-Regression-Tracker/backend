import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IgnoreAreaDto } from './ignore-area.dto';
import { UpdateIgnoreAreasDto } from './update-ignore-area.dto';

const area = { x: 1, y: 2, width: 3, height: 4 };

const failedProperties = async (dto: object): Promise<string[]> =>
  (await validate(dto)).map((error) => error.property).sort();

describe('UpdateIgnoreAreasDto', () => {
  it('accepts string ids and well formed areas', async () => {
    const dto = plainToInstance(UpdateIgnoreAreasDto, { ids: ['a', 'b'], ignoreAreas: [area] });

    expect(dto.ignoreAreas[0]).toBeInstanceOf(IgnoreAreaDto);
    expect(await failedProperties(dto)).toEqual([]);
  });

  it('rejects ids that are not strings and malformed areas', async () => {
    const dto = plainToInstance(UpdateIgnoreAreasDto, { ids: ['a', 1], ignoreAreas: [{ ...area, width: 'wide' }] });

    expect(await failedProperties(dto)).toEqual(['ids', 'ignoreAreas']);
  });

  it('rejects ids and areas that are not arrays', async () => {
    const dto = plainToInstance(UpdateIgnoreAreasDto, { ids: 'abc', ignoreAreas: area });

    expect(await failedProperties(dto)).toEqual(['ids', 'ignoreAreas']);
  });
});
