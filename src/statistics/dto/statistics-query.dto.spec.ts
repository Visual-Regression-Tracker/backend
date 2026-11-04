import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StatisticsQueryDto } from './statistics-query.dto';

const errorsOf = (plain: object) => validate(plainToInstance(StatisticsQueryDto, plain));

describe('StatisticsQueryDto', () => {
  const projectId = '7f8f3b1e-5a0b-4f57-9a43-2a5b1c0d9e11';

  it('accepts a project without a branch', async () => {
    await expect(errorsOf({ projectId })).resolves.toHaveLength(0);
  });

  it('accepts a project with a branch', async () => {
    await expect(errorsOf({ projectId, branchName: 'dev' })).resolves.toHaveLength(0);
  });

  it('rejects a missing or malformed project id', async () => {
    await expect(errorsOf({})).resolves.toHaveLength(1);
    await expect(errorsOf({ projectId: 'nope' })).resolves.toHaveLength(1);
  });
});
