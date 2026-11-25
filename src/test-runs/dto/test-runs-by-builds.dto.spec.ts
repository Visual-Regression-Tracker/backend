import { plainToClass } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_BUILDS_PER_REQUEST, TestRunsByBuildsDto } from './test-runs-by-builds.dto';

const errorsOf = async (body: unknown) => validate(plainToClass(TestRunsByBuildsDto, body));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('TestRunsByBuildsDto', () => {
  it('accepts a list of build ids', async () => {
    expect(await errorsOf({ buildIds: [uuid(1), uuid(2)] })).toHaveLength(0);
  });

  it('refuses no list, an empty one, a non-uuid and more builds than one query should read', async () => {
    expect(await errorsOf({})).not.toHaveLength(0);
    expect(await errorsOf({ buildIds: [] })).not.toHaveLength(0);
    expect(await errorsOf({ buildIds: ['not-a-uuid'] })).not.toHaveLength(0);
    const tooMany = Array.from({ length: MAX_BUILDS_PER_REQUEST + 1 }, (_, n) => uuid(n));
    expect(await errorsOf({ buildIds: tooMany })).not.toHaveLength(0);
  });
});
