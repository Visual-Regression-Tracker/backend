import { ApiFile } from './api-file.decorator';

const API_MODEL_PROPERTIES = 'swagger/apiModelProperties';
const API_MODEL_PROPERTIES_ARRAY = 'swagger/apiModelPropertiesArray';

class Upload {
  @ApiFile()
  single: unknown;

  @ApiFile({ isArray: true })
  multiple: unknown;

  @ApiFile({ isArray: false, description: 'ignored' })
  explicitSingle: unknown;
}

const propertyMetadata = (property: keyof Upload) =>
  Reflect.getMetadata(API_MODEL_PROPERTIES, Upload.prototype, property);

describe('ApiFile', () => {
  it('registers every decorated property with swagger', () => {
    expect(Reflect.getMetadata(API_MODEL_PROPERTIES_ARRAY, Upload.prototype)).toEqual([
      ':single',
      ':multiple',
      ':explicitSingle',
    ]);
  });

  it('documents a single binary file without options', () => {
    expect(propertyMetadata('single')).toEqual({ type: 'string', format: 'binary', isArray: false });
  });

  it('documents an array of binary files when isArray is set', () => {
    expect(propertyMetadata('multiple')).toEqual({
      type: 'array',
      isArray: true,
      items: { type: 'string', format: 'binary' },
    });
  });

  it('describes only isArray in the schema', () => {
    expect(propertyMetadata('explicitSingle')).toEqual({ type: 'string', format: 'binary', isArray: false });
  });
});
