import { plainToInstance } from 'class-transformer';
import { GlobalValidationPipe } from '../../shared/validation';
import { validate } from 'class-validator';
import { CreateTestRequestDto } from './create-test-request.dto';
import { CreateTestRequestBase64Dto } from './create-test-request-base64.dto';
import { CreateTestRequestMultipartDto } from './create-test-request-multipart.dto';
import { IgnoreAreaDto } from './ignore-area.dto';

const BUILD_ID = '146e7a8d-89f0-4565-aa2c-e61efabb0afd';
const PROJECT_ID = '3bc4a5bc-006e-4d43-8e4e-eaa132627fcc';
const area = { x: 1, y: 2, width: 3, height: 4 };

const base = {
  buildId: BUILD_ID,
  projectId: PROJECT_ID,
  name: 'name',
  branchName: 'develop',
};

const failedProperties = async (dto: object): Promise<string[]> =>
  (await validate(dto)).map((error) => error.property).sort();

describe('CreateTestRequestDto', () => {
  it('accepts the minimal request', async () => {
    expect(await failedProperties(plainToInstance(CreateTestRequestDto, base))).toEqual([]);
  });

  it('turns ignore areas into IgnoreAreaDto instances', () => {
    const dto = plainToInstance(CreateTestRequestDto, { ...base, ignoreAreas: [area] });

    expect(dto.ignoreAreas![0]).toBeInstanceOf(IgnoreAreaDto);
    expect(dto.ignoreAreas![0]).toEqual(area);
  });

  it('rejects ids that are not uuids, and malformed optional fields', async () => {
    const dto = plainToInstance(CreateTestRequestDto, {
      ...base,
      buildId: 'not a uuid',
      projectId: 'not a uuid',
      diffTollerancePercent: '1',
      merge: 'true',
      comment: 1,
    });

    expect(await failedProperties(dto)).toEqual(['buildId', 'comment', 'diffTollerancePercent', 'merge', 'projectId']);
  });

  it('baseates every ignore area', async () => {
    const dto = plainToInstance(CreateTestRequestDto, { ...base, ignoreAreas: [area, { ...area, x: 'one' }] });

    expect(await failedProperties(dto)).toEqual(['ignoreAreas']);
  });

  it('rejects ignore areas that are not an array', async () => {
    const dto = plainToInstance(CreateTestRequestDto, { ...base, ignoreAreas: area });

    expect(await failedProperties(dto)).toContain('ignoreAreas');
  });
});

describe('CreateTestRequestBase64Dto', () => {
  it('keeps the image as sent: Buffer.from ignores line breaks', async () => {
    const imageBase64 = 'aGVs\r\nbG8g\nd29y\rbGQ=';
    const dto = plainToInstance(CreateTestRequestBase64Dto, { ...base, imageBase64 });

    expect(dto.imageBase64).toBe(imageBase64);
    expect(await failedProperties(dto)).toEqual([]);
  });

  it('accepts any string; the controller rejects what is not a PNG', async () => {
    const dto = plainToInstance(CreateTestRequestBase64Dto, { ...base, imageBase64: 'not base64!' });

    expect(await failedProperties(dto)).toEqual([]);
  });

  it.each([[null], [5]])('rejects a missing, null or numeric image (%p) without throwing', async (imageBase64) => {
    const dto = plainToInstance(CreateTestRequestBase64Dto, { ...base, imageBase64 });

    expect(await failedProperties(dto)).toEqual(['imageBase64']);
  });
});

describe('CreateTestRequestMultipartDto', () => {
  const valid = { ...base, image: { fieldname: 'image', buffer: Buffer.from('x') } };

  it.each([
    ['1.5', 1.5],
    ['0', 0],
    ['abc', 0],
    ['', 0],
  ])('reads the diff tolerance %p from the form as %p', (value, expected) => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, diffTollerancePercent: value });

    expect(dto.diffTollerancePercent).toBe(expected);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['TRUE', false],
    ['1', false],
    [true, true],
  ])('reads merge %p from the form as %p', (value, expected) => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, merge: value });

    expect(dto.merge).toBe(expected);
  });

  it.each([
    ['a JSON string', JSON.stringify([area]), [area]],
    ['an empty string as an empty list', '', []],
  ])('reads ignore areas from %s', (_case, ignoreAreas, expected) => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, ignoreAreas });

    expect(dto.ignoreAreas).toEqual(expected);
  });

  it('keeps ignore areas that are not JSON as text, so validation rejects them', async () => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, ignoreAreas: '[{' });

    expect(dto.ignoreAreas).toBe('[{');
    expect(await failedProperties(dto)).toContain('ignoreAreas');
  });

  it('leaves absent form fields undefined', () => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid });

    expect({
      diffTollerancePercent: dto.diffTollerancePercent,
      merge: dto.merge,
      ignoreAreas: dto.ignoreAreas,
    }).toEqual({ diffTollerancePercent: undefined, merge: undefined, ignoreAreas: undefined });
  });

  it('accepts a request with the form fields converted', async () => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, {
      ...valid,
      diffTollerancePercent: '2',
      merge: 'true',
      ignoreAreas: JSON.stringify([area]),
    });

    expect(await failedProperties(dto)).toEqual([]);
  });

  it('rejects a request without the image', async () => {
    const { image: _image, ...withoutImage } = valid;

    expect(await failedProperties(plainToInstance(CreateTestRequestMultipartDto, withoutImage))).toEqual(['image']);
  });

  it('rejects a text field named image', async () => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, image: 'text' });

    expect(await failedProperties(dto)).toEqual(['image']);
  });

  it.each([
    ['a string coordinate', '[{"x":"1","y":1,"width":1,"height":1}]'],
    ['a coordinate beyond the bounds', '[{"x":-2e6,"y":1,"width":1,"height":1}]'],
    ['an object instead of an array', '{"x":1,"y":1,"width":1,"height":1}'],
  ])('validates every parsed ignore area: rejects %s', async (_, ignoreAreas) => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, ignoreAreas });

    expect(await failedProperties(dto)).toEqual(['ignoreAreas']);
  });

  it('validates every parsed ignore area: accepts fractional ones as IgnoreAreaDto', async () => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, {
      ...valid,
      ignoreAreas: '[{"x":1.5,"y":1,"width":1,"height":1}]',
    });

    expect(await failedProperties(dto)).toEqual([]);
    expect(dto.ignoreAreas![0]).toBeInstanceOf(IgnoreAreaDto);
  });

  it('takes already parsed ignore areas as they are', () => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, ignoreAreas: [area] });

    expect(dto.ignoreAreas).toEqual([area]);
    expect(dto.ignoreAreas![0]).toBeInstanceOf(IgnoreAreaDto);
  });

  it('keeps the id and every other key of an area', () => {
    const withExtras = { id: '1', ...area, extra: 2 };
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, ignoreAreas: JSON.stringify([withExtras]) });

    expect(dto.ignoreAreas).toEqual([withExtras]);
  });

  it('is parsed once by the global pipe, with the form values converted', async () => {
    const meta = { type: 'body' as const, metatype: CreateTestRequestMultipartDto, data: '' };
    const body = {
      ...valid,
      merge: 'true',
      diffTollerancePercent: '1.5',
      ignoreAreas: '[{"id":"7","x":1.5,"y":2,"width":3,"height":4}]',
      image: { fieldname: 'image', buffer: Buffer.from('png') },
    };

    const result = (await new GlobalValidationPipe().transform(body, meta)) as CreateTestRequestMultipartDto;

    expect(result.merge).toBe(true);
    expect(result.diffTollerancePercent).toBe(1.5);
    expect(result.ignoreAreas).toEqual([{ id: '7', x: 1.5, y: 2, width: 3, height: 4 }]);
    expect(Buffer.isBuffer(result.image.buffer)).toBe(true);
    expect(result.image.buffer.toString()).toBe('png');
  });
});
