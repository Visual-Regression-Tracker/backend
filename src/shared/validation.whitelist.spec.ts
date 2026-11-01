import { BadRequestException, Type } from '@nestjs/common';
import { ModifyBuildDto } from '../builds/dto/build-modify.dto';
import { CreateBuildDto } from '../builds/dto/build-create.dto';
import { UpdateProjectDto } from '../projects/dto/update-project.dto';
import { CreateProjectDto } from '../projects/dto/create-project.dto';
import { CreateTestRequestBase64Dto } from '../test-runs/dto/create-test-request-base64.dto';
import { CreateTestRequestMultipartDto } from '../test-runs/dto/create-test-request-multipart.dto';
import { UpdateIgnoreAreasDto } from '../test-runs/dto/update-ignore-area.dto';
import { UpdateTestRunDto } from '../test-runs/dto/update-test.dto';
import { MergeParams } from '../test-variations/types';
import { AssignRoleDto } from '../users/dto/assign-role.dto';
import { ChangePasswordDto } from '../users/dto/change-password.dto';
import { CreateUserDto } from '../users/dto/user-create.dto';
import { UserLoginRequestDto } from '../users/dto/user-login-request.dto';
import { UpdateUserDto } from '../users/dto/user-update.dto';
import { GlobalValidationPipe } from './validation';

const run = async (
  value: unknown,
  metatype: Type<unknown>,
  type: 'body' | 'query' = 'body'
): Promise<Record<string, any>> =>
  (await new GlobalValidationPipe().transform(value, { type, metatype, data: undefined })) as Record<string, any>;
const BUILD_ID = '146e7a8d-89f0-4565-aa2c-e61efabb0afd';
const PROJECT_ID = '3bc4a5bc-006e-4d43-8e4e-eaa132627fcc';
const area = { x: 1, y: 2, width: 3, height: 4 };

describe('global whitelist', () => {
  it('UpdateTestRunDto keeps only the comment', async () => {
    const body = await run({ comment: 'c', baselineName: 'x', ignoreAreas: 'bad' }, UpdateTestRunDto);
    expect(body).toEqual({ comment: 'c' });
  });

  it('UpdateIgnoreAreasDto keeps the id the web UI selects areas by', async () => {
    const body = await run(
      { ids: ['a'], ignoreAreas: [{ ...area, id: '1', junk: 'x' }], junk: 'x' },
      UpdateIgnoreAreasDto
    );
    expect(body).toEqual({ ids: ['a'], ignoreAreas: [{ ...area, id: '1' }] });
  });

  it('CreateTestRequestBase64Dto keeps sourceBranch and the area ids', async () => {
    const body = await run(
      {
        buildId: BUILD_ID,
        projectId: PROJECT_ID,
        name: 'n',
        branchName: 'b',
        sourceBranch: 'release',
        imageBase64: 'abc',
        ignoreAreas: [{ ...area, id: '1', junk: 'x' }],
        junk: 'x',
      },
      CreateTestRequestBase64Dto
    );
    expect(body).toMatchObject({ sourceBranch: 'release', imageBase64: 'abc', ignoreAreas: [{ ...area, id: '1' }] });
    expect(body).not.toHaveProperty('junk');
    expect(body.ignoreAreas[0]).not.toHaveProperty('junk');
  });

  describe('CreateTestRequestMultipartDto', () => {
    const form = {
      buildId: BUILD_ID,
      projectId: PROJECT_ID,
      name: 'n',
      branchName: 'b',
      image: { fieldname: 'image', buffer: Buffer.from([1]) },
    };

    it('is parsed once, with the image, the areas and sourceBranch kept', async () => {
      const body = await run(
        {
          ...form,
          merge: 'true',
          diffTollerancePercent: '1.5',
          ignoreAreas: JSON.stringify([{ ...area, id: '1' }]),
          sourceBranch: 'release',
          junk: 'x',
        },
        CreateTestRequestMultipartDto
      );
      expect(Buffer.isBuffer(body.image.buffer)).toBe(true);
      expect(body.merge).toBe(true);
      expect(body.diffTollerancePercent).toBe(1.5);
      expect(body.ignoreAreas).toEqual([{ ...area, id: '1' }]);
      expect(body.sourceBranch).toBe('release');
      expect(body).not.toHaveProperty('junk');
    });

    it('turns empty form fields into the defaults', async () => {
      const body = await run(
        { ...form, merge: '', diffTollerancePercent: '', ignoreAreas: '' },
        CreateTestRequestMultipartDto
      );
      expect(body).toMatchObject({ merge: false, diffTollerancePercent: 0, ignoreAreas: [] });
    });
  });

  describe('ModifyBuildDto', () => {
    it('still rejects fields it does not declare', async () => {
      await expect(run({ branchName: 'x' }, ModifyBuildDto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('passes the declared fields', async () => {
      expect(await run({ isRunning: false }, ModifyBuildDto)).toEqual({ isRunning: false });
    });

    it('keeps an empty body empty', async () => {
      expect(await run(undefined, ModifyBuildDto)).toBeUndefined();
    });
  });

  it('MergeParams keeps its three query parameters', async () => {
    const body = await run({ projectId: PROJECT_ID, fromBranch: 'a', toBranch: 'b', junk: 'x' }, MergeParams, 'query');
    expect(body).toEqual({ projectId: PROJECT_ID, fromBranch: 'a', toBranch: 'b' });
  });

  describe('projects', () => {
    const project = {
      id: PROJECT_ID,
      name: 'p',
      mainBranchName: 'master',
      autoApproveFeature: true,
      imageComparison: 'pixelmatch',
      maxBuildAllowed: 5,
      maxBranchLifetime: 7,
      imageComparisonConfig: '{}',
      bulkApproveVariations: false,
      bulkApproveGroupBy: 'name',
    };

    it('UpdateProjectDto drops the counters and dates, keeps the ten settings', async () => {
      const body = await run({ ...project, buildsCounter: 3, createdAt: '2020-01-01', junk: 'x' }, UpdateProjectDto);
      expect(body).toEqual(project);
    });

    it('CreateProjectDto has no id', async () => {
      const { id: _id, ...fields } = project;
      expect(await run({ ...project, junk: 'x' }, CreateProjectDto)).toEqual(fields);
    });
  });

  it.each([
    ['CreateBuildDto', CreateBuildDto, { project: 'p', branchName: 'b', ciBuildId: 'c' }],
    ['CreateUserDto', CreateUserDto, { email: 'a@b.co', password: 'p', firstName: 'f', lastName: 'l' }],
    ['UserLoginRequestDto', UserLoginRequestDto, { email: 'a@b.co', password: 'p' }],
    ['UpdateUserDto', UpdateUserDto, { email: 'a@b.co', firstName: 'f', lastName: 'l' }],
    ['AssignRoleDto', AssignRoleDto, { id: PROJECT_ID, role: 'editor' }],
    ['ChangePasswordDto', ChangePasswordDto, { password: 'p' }],
  ] as const)('%s keeps its declared fields and drops the rest', async (_name, dto, fields) => {
    expect(await run({ ...fields, junk: 'x' }, dto as Type<unknown>)).toEqual(fields);
  });

  it('leaves an array body of ids alone', async () => {
    const ids = ['a', 'b'];
    expect(await run(ids, Array as unknown as Type<unknown>)).toBe(ids);
  });
});
