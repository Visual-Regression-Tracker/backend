import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTestRequestDto } from './create-test-request.dto';
import { CreateTestRequestBase64Dto } from './create-test-request-base64.dto';
import { CreateTestRequestMultipartDto } from './create-test-request-multipart.dto';
import { IgnoreAreaDto } from './ignore-area.dto';

const BUILD_ID = '146e7a8d-89f0-4565-aa2c-e61efabb0afd';
const PROJECT_ID = '3bc4a5bc-006e-4d43-8e4e-eaa132627fcc';
const area = { x: 1, y: 2, width: 3, height: 4 };

const failedProperties = async (dto: object): Promise<string[]> =>
  (await validate(dto)).map((error) => error.property).sort();

describe('CreateTestRequestDto', () => {
  const valid = {
    buildId: BUILD_ID,
    projectId: PROJECT_ID,
    name: 'name',
    branchName: 'develop',
  };

  it('accepts the minimal request', async () => {
    expect(await failedProperties(plainToInstance(CreateTestRequestDto, valid))).toEqual([]);
  });

  it('turns ignore areas into IgnoreAreaDto instances', () => {
    const dto = plainToInstance(CreateTestRequestDto, { ...valid, ignoreAreas: [area] });

    expect(dto.ignoreAreas[0]).toBeInstanceOf(IgnoreAreaDto);
    expect(dto.ignoreAreas[0]).toEqual(area);
  });

  it('rejects ids that are not uuids, and malformed optional fields', async () => {
    const dto = plainToInstance(CreateTestRequestDto, {
      ...valid,
      buildId: 'not a uuid',
      projectId: 'not a uuid',
      diffTollerancePercent: '1',
      merge: 'true',
      comment: 1,
    });

    expect(await failedProperties(dto)).toEqual(['buildId', 'comment', 'diffTollerancePercent', 'merge', 'projectId']);
  });

  it('validates every ignore area', async () => {
    const dto = plainToInstance(CreateTestRequestDto, { ...valid, ignoreAreas: [area, { ...area, x: 'one' }] });

    expect(await failedProperties(dto)).toEqual(['ignoreAreas']);
  });

  it('rejects ignore areas that are not an array', async () => {
    const dto = plainToInstance(CreateTestRequestDto, { ...valid, ignoreAreas: area });

    expect(await failedProperties(dto)).toContain('ignoreAreas');
  });
});

describe('CreateTestRequestBase64Dto', () => {
  const valid = {
    buildId: BUILD_ID,
    projectId: PROJECT_ID,
    name: 'name',
    branchName: 'develop',
  };

  it('strips line breaks from the image before validating it', async () => {
    const dto = plainToInstance(CreateTestRequestBase64Dto, { ...valid, imageBase64: 'aGVs\r\nbG8g\nd29y\rbGQ=' });

    expect(dto.imageBase64).toBe('aGVsbG8gd29ybGQ=');
    expect(await failedProperties(dto)).toEqual([]);
  });

  it('rejects an image that is not base64', async () => {
    const dto = plainToInstance(CreateTestRequestBase64Dto, { ...valid, imageBase64: 'not base64!' });

    expect(await failedProperties(dto)).toEqual(['imageBase64']);
  });
});

describe('CreateTestRequestMultipartDto', () => {
  const valid = {
    buildId: BUILD_ID,
    projectId: PROJECT_ID,
    name: 'name',
    branchName: 'develop',
  };

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
  ])('reads merge %p from the form as %p', (value, expected) => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, merge: value });

    expect(dto.merge).toBe(expected);
  });

  it('reads ignore areas from a JSON string', () => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, ignoreAreas: JSON.stringify([area]) });

    expect(dto.ignoreAreas).toEqual([area]);
  });

  it('reads empty ignore areas as an empty list', () => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, ignoreAreas: '' });

    expect(dto.ignoreAreas).toEqual([]);
  });

  it('throws on ignore areas that are not JSON', () => {
    expect(() => plainToInstance(CreateTestRequestMultipartDto, { ...valid, ignoreAreas: '[{' })).toThrow(SyntaxError);
  });

  it('leaves absent form fields undefined', () => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid });

    expect({
      diffTollerancePercent: dto.diffTollerancePercent,
      merge: dto.merge,
      ignoreAreas: dto.ignoreAreas,
    }).toEqual({ diffTollerancePercent: undefined, merge: undefined, ignoreAreas: undefined });
  });

  it('reads a JSON boolean merge as false', () => {
    const dto = plainToInstance(CreateTestRequestMultipartDto, { ...valid, merge: true });

    // NOTE: current behavior — only the string 'true' counts, `true == 'true'` is false
    expect(dto.merge).toBe(false);
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
});
