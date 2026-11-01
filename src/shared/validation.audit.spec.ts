import { getMetadataStorage } from 'class-validator';
import { ModifyBuildDto } from '../builds/dto/build-modify.dto';
import { CreateBuildDto } from '../builds/dto/build-create.dto';
import { CreateProjectDto } from '../projects/dto/create-project.dto';
import { UpdateProjectDto } from '../projects/dto/update-project.dto';
import { CreateTestRequestBase64Dto } from '../test-runs/dto/create-test-request-base64.dto';
import { CreateTestRequestMultipartDto } from '../test-runs/dto/create-test-request-multipart.dto';
import { CreateTestRequestDto } from '../test-runs/dto/create-test-request.dto';
import { IgnoreAreaDto } from '../test-runs/dto/ignore-area.dto';
import { UpdateIgnoreAreasDto } from '../test-runs/dto/update-ignore-area.dto';
import { UpdateTestRunDto } from '../test-runs/dto/update-test.dto';
import { MergeParams } from '../test-variations/types';
import { AssignRoleDto } from '../users/dto/assign-role.dto';
import { ChangePasswordDto } from '../users/dto/change-password.dto';
import { CreateUserDto } from '../users/dto/user-create.dto';
import { UserLoginRequestDto } from '../users/dto/user-login-request.dto';
import { UpdateUserDto } from '../users/dto/user-update.dto';
import { BaselineDataDto } from './dto/baseline-data.dto';

type DtoClass = abstract new (...args: any[]) => unknown;

const declared = (dto: DtoClass): string[] =>
  ((Reflect.getMetadata('swagger/apiModelPropertiesArray', dto.prototype) ?? []) as string[]).map((name) =>
    name.replace(/^:/, '')
  );
const validated = (dto: DtoClass): Set<string> =>
  new Set(
    getMetadataStorage()
      .getTargetValidationMetadatas(dto, '', true, false)
      .map((m) => m.propertyName)
  );

describe.each([
  IgnoreAreaDto,
  UpdateIgnoreAreasDto,
  UpdateTestRunDto,
  BaselineDataDto,
  CreateTestRequestDto,
  CreateTestRequestBase64Dto,
  CreateTestRequestMultipartDto,
  CreateBuildDto,
  ModifyBuildDto,
  CreateProjectDto,
  UpdateProjectDto,
  CreateUserDto,
  UserLoginRequestDto,
  UpdateUserDto,
  AssignRoleDto,
  ChangePasswordDto,
])('%p', (dto) => {
  it('validates every declared property', () => {
    const properties = declared(dto);
    expect(properties).not.toEqual([]);
    expect(properties.filter((name) => !validated(dto).has(name))).toEqual([]);
  });
});

describe('MergeParams', () => {
  it('validates every query parameter', () => {
    expect([...validated(MergeParams)].sort()).toEqual(['fromBranch', 'projectId', 'toBranch']);
  });
});

describe('CreateTestRequestDto', () => {
  it('validates sourceBranch, which the variation lookup reads', () => {
    expect(validated(CreateTestRequestDto).has('sourceBranch')).toBe(true);
    expect(validated(CreateTestRequestMultipartDto).has('sourceBranch')).toBe(true);
  });
});
