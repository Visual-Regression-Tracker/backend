import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NoiseAnalysisRequestDto } from './noise-analysis-request.dto';

const failedProperties = async (body: unknown): Promise<string[]> =>
  (await validate(plainToInstance(NoiseAnalysisRequestDto, body))).map((error) => error.property);

const id = '10fb5e02-64e0-4cf5-9f17-c00ab3c96658';

describe('NoiseAnalysisRequestDto', () => {
  it('accepts a list of uuids', async () => {
    expect(await failedProperties({ ids: [id, '3bc4a5bc-006e-4d43-8e4e-eaa132627fca'] })).toEqual([]);
  });

  it('accepts 1000 ids', async () => {
    expect(await failedProperties({ ids: Array.from({ length: 1000 }, () => id) })).toEqual([]);
  });

  it.each([
    ['more than 1000 ids', { ids: Array.from({ length: 1001 }, () => id) }],
    ['an empty list', { ids: [] }],
    ['an id that is not a uuid', { ids: [id, 'abc'] }],
    ['an id that is not a string', { ids: [1] }],
    ['ids that are not a list', { ids: id }],
    ['no ids', {}],
  ])('rejects %s', async (_name, body) => {
    expect(await failedProperties(body)).toEqual(['ids']);
  });
});
