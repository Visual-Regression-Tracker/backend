import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, PIPES_METADATA } from '@nestjs/common/constants';
import { ValidationPipe } from '@nestjs/common';
import { Role, TestStatus, User } from '@prisma/client';
import { TestRunsController } from './test-runs.controller';
import { TestRunsService } from './test-runs.service';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ApiGuard } from '../auth/guards/api.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { FileToBodyInterceptor } from '../shared/fite-to-body.interceptor';
import { generateTestRun } from '../_data_';
import { CreateTestRequestBase64Dto } from './dto/create-test-request-base64.dto';
import { CreateTestRequestMultipartDto } from './dto/create-test-request-multipart.dto';
import { UpdateIgnoreAreasDto } from './dto/update-ignore-area.dto';

const initController = async (testRunsService: Partial<Record<keyof TestRunsService, jest.Mock>> = {}) => {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [TestRunsController],
    providers: [
      { provide: TestRunsService, useValue: testRunsService },
      { provide: TestVariationsService, useValue: {} },
      { provide: PrismaService, useValue: {} },
    ],
  }).compile();

  return module.get<TestRunsController>(TestRunsController);
};

describe('TestRuns Controller', () => {
  let controller: TestRunsController;
  const user = { id: 'user id' } as User;
  const ignoreAreas = [{ x: 1, y: 2, width: 3, height: 4 }];

  beforeEach(async () => {
    controller = await initController();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists the test runs of a build', async () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    const findMany = jest.fn().mockResolvedValueOnce(list);
    controller = await initController({ findMany });

    const result = await controller.get('build id');

    expect(findMany).toHaveBeenCalledWith('build id');
    expect(result).toBe(list);
  });

  it('returns the details of one test run as the service gives them', async () => {
    const testRun = generateTestRun();
    const findOne = jest.fn().mockResolvedValueOnce(testRun);
    controller = await initController({ findOne });

    const result = await controller.getDetails(testRun.id);

    expect(findOne).toHaveBeenCalledWith(testRun.id);
    // NOTE: current behavior — returned raw (no TestRunDto mapping), so it also carries testVariation etc.
    expect(result).toBe(testRun);
  });

  describe('approveTestRun', () => {
    it('approves every id one after another with merge flag, no auto-approve and the current user', async () => {
      const order: string[] = [];
      const approve = jest.fn().mockImplementation(async (id: string) => {
        order.push(`start ${id}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
        order.push(`end ${id}`);
      });
      controller = await initController({ approve });

      const result = await controller.approveTestRun(user, ['1', '2'], true);

      expect(approve).toHaveBeenNthCalledWith(1, '1', true, false, user.id);
      expect(approve).toHaveBeenNthCalledWith(2, '2', true, false, user.id);
      expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
      expect(result).toBeUndefined();
    });

    it('stops at the first failing id', async () => {
      const approve = jest.fn().mockRejectedValueOnce(new Error('boom'));
      controller = await initController({ approve });

      await expect(controller.approveTestRun(user, ['1', '2'], false)).rejects.toThrow('boom');

      expect(approve).toHaveBeenCalledTimes(1);
      expect(approve).toHaveBeenCalledWith('1', false, false, user.id);
    });

    it('does nothing for an empty list', async () => {
      const approve = jest.fn();
      controller = await initController({ approve });

      await controller.approveTestRun(user, [], false);

      expect(approve).not.toHaveBeenCalled();
    });
  });

  it('returns the matching variations of a test run', async () => {
    const group = { variations: [{ id: 'a' }], skipped: [] };
    const getMatchingVariations = jest.fn().mockResolvedValueOnce(group);
    controller = await initController({ getMatchingVariations });

    const result = await controller.getMatchingSiblings('a');

    expect(getMatchingVariations).toHaveBeenCalledWith('a');
    expect(result).toBe(group);
  });

  it('rejects every id by setting its status to failed', async () => {
    const setStatus = jest.fn().mockResolvedValue(undefined);
    controller = await initController({ setStatus });

    const result = await controller.reject(['1', '2']);

    expect(setStatus.mock.calls).toEqual([
      ['1', TestStatus.failed],
      ['2', TestStatus.failed],
    ]);
    expect(result).toBeUndefined();
  });

  it('deletes every id', async () => {
    const deleteMock = jest.fn().mockResolvedValue(undefined);
    controller = await initController({ delete: deleteMock });

    const result = await controller.delete(['1', '2']);

    expect(deleteMock.mock.calls).toEqual([['1'], ['2']]);
    expect(result).toBeUndefined();
  });

  it('replaces the ignore areas of every id with the same areas', async () => {
    const updateIgnoreAreas = jest.fn().mockResolvedValue(undefined);
    controller = await initController({ updateIgnoreAreas });
    const data: UpdateIgnoreAreasDto = { ids: ['1', '2'], ignoreAreas };

    const result = await controller.updateIgnoreAreas(data);

    expect(updateIgnoreAreas.mock.calls).toEqual([
      ['1', ignoreAreas],
      ['2', ignoreAreas],
    ]);
    expect(result).toBeUndefined();
  });

  it('adds the same ignore areas to every id', async () => {
    const addIgnoreAreas = jest.fn().mockResolvedValue(undefined);
    controller = await initController({ addIgnoreAreas });
    const data: UpdateIgnoreAreasDto = { ids: ['1', '2'], ignoreAreas };

    const result = await controller.addIgnoreAreas(data);

    expect(addIgnoreAreas.mock.calls).toEqual([
      ['1', ignoreAreas],
      ['2', ignoreAreas],
    ]);
    expect(result).toBeUndefined();
  });

  it('updates the comment of a test run and returns what the service returns', async () => {
    const testRun = generateTestRun({ comment: 'new' });
    const update = jest.fn().mockResolvedValueOnce(testRun);
    controller = await initController({ update });

    const result = await controller.update(testRun.id, { comment: 'new' });

    expect(update).toHaveBeenCalledWith(testRun.id, { comment: 'new' });
    expect(result).toBe(testRun);
  });

  it('decodes the base64 image and posts the test run', async () => {
    const response = { id: 'result' };
    const postTestRun = jest.fn().mockResolvedValueOnce(response);
    controller = await initController({ postTestRun });
    const createTestRequestDto = {
      buildId: 'build',
      projectId: 'project',
      name: 'name',
      branchName: 'develop',
      imageBase64: Buffer.from('png bytes').toString('base64'),
    } as CreateTestRequestBase64Dto;

    const result = await controller.postTestRun(createTestRequestDto);

    expect(postTestRun).toHaveBeenCalledWith({ createTestRequestDto, imageBuffer: Buffer.from('png bytes') });
    // NOTE: current behavior — the whole dto, imageBase64 included, is passed on to the service
    expect(postTestRun.mock.calls[0][0].createTestRequestDto.imageBase64).toBe(createTestRequestDto.imageBase64);
    expect(result).toBe(response);
  });

  it('posts a multipart test run with the uploaded file buffer', async () => {
    const response = { id: 'result' };
    const postTestRun = jest.fn().mockResolvedValueOnce(response);
    controller = await initController({ postTestRun });
    const buffer = Buffer.from('png bytes');
    const createTestRequestDto = {
      buildId: 'build',
      projectId: 'project',
      name: 'name',
      branchName: 'develop',
      image: { buffer } as Express.Multer.File,
    } as CreateTestRequestMultipartDto;

    const result = await controller.postTestRunMultipart(createTestRequestDto);

    expect(postTestRun).toHaveBeenCalledWith({ createTestRequestDto, imageBuffer: buffer });
    expect(result).toBe(response);
  });

  describe('route protection', () => {
    const guardsOf = (method: keyof TestRunsController) =>
      Reflect.getMetadata(GUARDS_METADATA, TestRunsController.prototype[method]);
    const rolesOf = (method: keyof TestRunsController) =>
      Reflect.getMetadata('roles', TestRunsController.prototype[method]);

    it.each(['get', 'getDetails', 'getMatchingSiblings'] as const)(
      '%s needs a logged in user and no role',
      (method) => {
        expect(guardsOf(method)).toEqual([JwtAuthGuard]);
        expect(rolesOf(method)).toBeUndefined();
      }
    );

    it.each(['approveTestRun', 'reject', 'delete', 'updateIgnoreAreas', 'addIgnoreAreas', 'update'] as const)(
      '%s needs a logged in admin or editor',
      (method) => {
        expect(guardsOf(method)).toEqual([JwtAuthGuard, RoleGuard]);
        expect(rolesOf(method)).toEqual([Role.admin, Role.editor]);
      }
    );

    it.each(['postTestRun', 'postTestRunMultipart'] as const)('%s needs an admin or editor api key', (method) => {
      expect(guardsOf(method)).toEqual([ApiGuard, RoleGuard]);
      expect(rolesOf(method)).toEqual([Role.admin, Role.editor]);
    });

    it('moves the uploaded image into the body and validates the multipart request', () => {
      const method = TestRunsController.prototype.postTestRunMultipart;
      const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, method);
      const pipes = Reflect.getMetadata(PIPES_METADATA, method);

      expect(interceptors).toHaveLength(2);
      expect(interceptors[1]).toBe(FileToBodyInterceptor);
      expect(pipes).toHaveLength(1);
      expect(pipes[0]).toBeInstanceOf(ValidationPipe);
      expect(pipes[0]).toMatchObject({
        isTransformEnabled: true,
        validatorOptions: expect.objectContaining({ forbidUnknownValues: true }),
      });
    });
  });
});
