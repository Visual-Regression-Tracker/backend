import { Pagination } from '../../shared/dto/pagination.dto';
import { PaginatedTestRunDto } from './testRun-paginated.dto';
import { TestRunDto } from './testRun.dto';

const API_MODEL_PROPERTIES = 'swagger/apiModelProperties';
const API_MODEL_PROPERTIES_ARRAY = 'swagger/apiModelPropertiesArray';

describe('PaginatedTestRunDto', () => {
  it('is a page of test runs', () => {
    expect(new PaginatedTestRunDto()).toBeInstanceOf(Pagination);
  });

  it('documents the pagination fields and the test runs it holds', () => {
    const properties = Reflect.getMetadata(API_MODEL_PROPERTIES_ARRAY, PaginatedTestRunDto.prototype);
    const data = Reflect.getMetadata(API_MODEL_PROPERTIES, PaginatedTestRunDto.prototype, 'data');

    expect(properties).toEqual([':take', ':skip', ':total', ':data']);
    expect(data).toMatchObject({ type: TestRunDto, isArray: true });
  });
});
