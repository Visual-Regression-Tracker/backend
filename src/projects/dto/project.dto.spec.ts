import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ImageComparison } from '@prisma/client';
import { DEFAULT_NOISE_ANALYSIS_CONFIG } from '../../compare/noise-hint/noise-analysis.config';
import { ProjectDto } from './project.dto';

const plainProject = {
  id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
  buildsCounter: 3,
  name: 'Project',
  mainBranchName: 'master',
  createdAt: '2024-01-02T03:04:05.000Z',
  updatedAt: '2024-02-03T04:05:06.000Z',
  autoApproveFeature: true,
  imageComparison: ImageComparison.pixelmatch,
  maxBuildAllowed: 100,
  maxBranchLifetime: 30,
  imageComparisonConfig: '{"threshold":0.1}',
  noiseAnalysisConfig: JSON.stringify(DEFAULT_NOISE_ANALYSIS_CONFIG),
  bulkApproveVariations: false,
  bulkApproveGroupBy: 'customTags',
};

describe('ProjectDto', () => {
  it('turns the date strings into Dates', () => {
    const dto = plainToInstance(ProjectDto, plainProject);

    expect(dto.createdAt).toEqual(new Date('2024-01-02T03:04:05.000Z'));
    expect(dto.updatedAt).toEqual(new Date('2024-02-03T04:05:06.000Z'));
  });

  it('accepts a complete project', async () => {
    await expect(validate(plainToInstance(ProjectDto, plainProject))).resolves.toEqual([]);
  });

  it.each([
    ['id', { id: 'not-a-uuid' }, 'isUuid'],
    ['buildsCounter', { buildsCounter: '3' }, 'isNumber'],
    ['createdAt', { createdAt: 'not a date' }, 'isDate'],
    ['imageComparison', { imageComparison: 'resemble' }, 'isEnum'],
    ['imageComparisonConfig', { imageComparisonConfig: '{not json' }, 'isJson'],
    ['noiseAnalysisConfig', { noiseAnalysisConfig: 'not json' }, 'isJson'],
    ['autoApproveFeature', { autoApproveFeature: 'yes' }, 'isBoolean'],
    ['bulkApproveGroupBy', { bulkApproveGroupBy: 1 }, 'isString'],
    ['maxBuildAllowed', { maxBuildAllowed: 1.5 }, 'isInt'],
    ['maxBranchLifetime', { maxBranchLifetime: 0.5 }, 'isInt'],
  ])('rejects an invalid %s', async (property, override, constraint) => {
    const errors = await validate(plainToInstance(ProjectDto, { ...plainProject, ...override }));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe(property);
    expect(Object.keys(errors[0].constraints!)).toEqual([constraint]);
  });

  it('accepts a project from an older client that sends no noiseAnalysisConfig', async () => {
    const { noiseAnalysisConfig: _omitted, ...oldClientProject } = plainProject;

    await expect(validate(plainToInstance(ProjectDto, oldClientProject))).resolves.toEqual([]);
  });

  it.each([0, -1, 1, 100])('still accepts the integer %p for both counters', async (value) => {
    const dto = plainToInstance(ProjectDto, { ...plainProject, maxBuildAllowed: value, maxBranchLifetime: value });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});
