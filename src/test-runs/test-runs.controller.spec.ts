import { Test, TestingModule } from '@nestjs/testing';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  INTERCEPTORS_METADATA,
  PATH_METADATA,
  PIPES_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { BadRequestException, NotFoundException, ParseArrayPipe } from '@nestjs/common';
import { PNG } from 'pngjs';
import { Prisma, Role, User } from '@prisma/client';
import { TestRunsController, multipartLimits, parseIds, parseUuidIds } from './test-runs.controller';
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

const png = PNG.sync.write(new PNG({ width: 1, height: 1 }));
const request = { buildId: 'build', projectId: 'project', name: 'name', branchName: 'develop' };

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

const stub = async (method: keyof TestRunsService, result?: unknown) => {
  const mock = jest.fn().mockResolvedValue(result);
  return { controller: await initController({ [method]: mock }), mock };
};

describe('TestRuns Controller', () => {
  const user = { id: 'user id' } as User;
  const ignoreAreas = [{ x: 1, y: 2, width: 3, height: 4 }];

  it('should be defined', async () => {
    expect(await initController()).toBeDefined();
  });

  it('lists the test runs of a build', async () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    const { controller, mock } = await stub('findMany', list);

    const result = await controller.get('build id');

    expect(mock).toHaveBeenCalledWith('build id');
    expect(result).toBe(list);
  });

  it('returns the run as stored, with its variation (kept for existing clients)', async () => {
    const testRun = generateTestRun();
    const { controller, mock } = await stub('findOneOrThrow', testRun);

    const result = await controller.getDetails(testRun.id);

    expect(mock).toHaveBeenCalledWith(testRun.id);
    expect(result).toBe(testRun);
  });

  describe('approveTestRun', () => {
    it('approves every id one after another with merge flag, no auto-approve and the current user', async () => {
      const order: string[] = [];
      const { controller, mock } = await stub('approve');
      mock.mockImplementation(async (id: string) => {
        order.push(`start ${id}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
        order.push(`end ${id}`);
      });

      const result = await controller.approveTestRun(user, ['1', '2'], true);

      expect(mock).toHaveBeenNthCalledWith(1, '1', true, false, user.id);
      expect(mock).toHaveBeenNthCalledWith(2, '2', true, false, user.id);
      expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
      expect(result).toEqual({ succeeded: ['1', '2'], failed: [] });
    });

    it('reports the details of an HTTP error as its message', async () => {
      const { controller, mock } = await stub('approve');
      mock.mockRejectedValueOnce(new BadRequestException(['first problem', 'second problem']));

      const result = await controller.approveTestRun(user, ['1'], false);

      expect(result.failed).toEqual([{ id: '1', message: 'first problem, second problem' }]);
    });

    it('goes on past a failing id and reports it with its message', async () => {
      const { controller, mock } = await stub('approve');
      mock.mockRejectedValueOnce(new NotFoundException('Test run not found: 1'));

      const result = await controller.approveTestRun(user, ['1', '2'], false);

      expect(mock).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ succeeded: ['2'], failed: [{ id: '1', message: 'Test run not found: 1' }] });
    });

    it('answers an empty result for an empty list', async () => {
      const { controller, mock } = await stub('approve');

      await expect(controller.approveTestRun(user, [], false)).resolves.toEqual({ succeeded: [], failed: [] });

      expect(mock).not.toHaveBeenCalled();
    });
  });

  it('returns the matching variations of a test run', async () => {
    const group = { variations: [{ id: 'a' }], skipped: [] as unknown[] };
    const { controller, mock } = await stub('getMatchingVariations', group);

    const result = await controller.getMatchingSiblings('a');

    expect(mock).toHaveBeenCalledWith('a');
    expect(result).toBe(group);
  });

  it.each(['reject', 'delete'] as const)('%s goes through every id one by one', async (method) => {
    const { controller, mock } = await stub(method);

    const result = await controller[method](['1', '2']);

    expect(mock.mock.calls).toEqual([['1'], ['2']]);
    expect(result).toEqual({ succeeded: ['1', '2'], failed: [] });
  });

  it.each(['reject', 'delete'] as const)('%s reports an id the database no longer has and goes on', async (method) => {
    const { controller, mock } = await stub(method);
    mock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'x' })
    );

    const result = await controller[method](['ID-1', 'ID-2']);

    expect(result).toEqual({ succeeded: ['ID-2'], failed: [{ id: 'ID-1', message: 'Record not found' }] });
  });

  it.each(['approveTestRun', 'reject', 'delete'] as const)(
    '%s fails the request on an error that is not about the id',
    async (method) => {
      const controller = await initController({
        approve: jest.fn().mockRejectedValue(new Error('database is down')),
        reject: jest.fn().mockRejectedValue(new Error('database is down')),
        delete: jest.fn().mockRejectedValue(new Error('database is down')),
      });

      const call =
        method === 'approveTestRun' ? controller.approveTestRun(user, ['1'], false) : controller[method](['1']);

      await expect(call).rejects.toThrow('database is down');
    }
  );

  it.each(['approveTestRun', 'reject', 'delete'] as const)('%s answers 200', (method) => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, TestRunsController.prototype[method])).toBe(200);
  });

  it('revert passes the ids to the service as one request and answers 204', async () => {
    const { controller, mock } = await stub('revert');

    const result = await controller.revert(['1', '2']);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith(['1', '2']);
    expect(result).toBeUndefined();
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, TestRunsController.prototype.revert)).toBe(204);
    expect(Reflect.getMetadata(PATH_METADATA, TestRunsController.prototype.revert)).toBe('revert');
  });

  it.each(['updateIgnoreAreas', 'addIgnoreAreas'] as const)('%s hands the same areas to every id', async (method) => {
    const { controller, mock } = await stub(method);
    const data: UpdateIgnoreAreasDto = { ids: ['1', '2'], ignoreAreas };

    const result = await controller[method](data);

    expect(mock.mock.calls).toEqual([
      ['1', ignoreAreas],
      ['2', ignoreAreas],
    ]);
    expect(result).toBeUndefined();
  });

  it('updates the comment of a test run and returns what the service returns', async () => {
    const testRun = generateTestRun({ comment: 'new' });
    const { controller, mock } = await stub('update', testRun);

    const result = await controller.update(testRun.id, { comment: 'new' });

    expect(mock).toHaveBeenCalledWith(testRun.id, { comment: 'new' });
    expect(result).toBe(testRun);
  });

  it('passes the request and the decoded image to the service', async () => {
    const response = { id: 'result' };
    const { controller, mock } = await stub('postTestRun', response);
    const createTestRequestDto = { ...request, imageBase64: png.toString('base64') } as CreateTestRequestBase64Dto;

    const result = await controller.postTestRun(createTestRequestDto);

    expect(mock).toHaveBeenCalledWith({ createTestRequestDto, imageBuffer: png });
    expect(mock.mock.calls[0][0].createTestRequestDto.imageBase64).toBe(createTestRequestDto.imageBase64);
    expect(result).toBe(response);
  });

  it('posts a multipart test run with the uploaded file buffer', async () => {
    const response = { id: 'result' };
    const { controller, mock } = await stub('postTestRun', response);
    const createTestRequestDto = {
      ...request,
      image: { buffer: png } as Express.Multer.File,
    } as CreateTestRequestMultipartDto;

    const result = await controller.postTestRunMultipart(createTestRequestDto);

    expect(mock).toHaveBeenCalledWith({ createTestRequestDto, imageBuffer: png });
    expect(result).toBe(response);
  });

  it.each([
    [
      'a base64 image that is not a PNG',
      (controller: TestRunsController) =>
        controller.postTestRun({ imageBase64: Buffer.from('GIF89a').toString('base64') } as CreateTestRequestBase64Dto),
    ],
    [
      'a multipart image without a buffer',
      (controller: TestRunsController) =>
        controller.postTestRunMultipart({ image: {} as Express.Multer.File } as CreateTestRequestMultipartDto),
    ],
  ])('rejects %s and posts nothing', async (_case, post) => {
    const { controller, mock } = await stub('postTestRun');

    await expect(post(controller)).rejects.toThrow(BadRequestException);
    expect(mock).not.toHaveBeenCalled();
  });

  it.each(['approveTestRun', 'reject', 'delete', 'revert'] as const)(
    'validates the bulk ids of %s as an array',
    (method) => {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestRunsController, method) as Record<
        string,
        { data?: unknown; pipes: unknown[] }
      >;

      const pipes = Object.values(args).flatMap((arg) => arg.pipes);

      expect(pipes.some((pipe) => pipe instanceof ParseArrayPipe)).toBe(true);
    }
  );

  it('parseIds rejects a body that is not an array and passes an array through', async () => {
    const pipe = parseIds();

    await expect(pipe.transform({ ids: [] }, { type: 'body' })).rejects.toThrow(BadRequestException);
    await expect(pipe.transform(['a', 'b'], { type: 'body' })).resolves.toEqual(['a', 'b']);
  });

  it('parseUuidIds rejects ids that are not uuids and passes uuids through', () => {
    const pipe = parseUuidIds();
    const id = '10fb5e02-64e0-4cf5-9f17-c00ab3c96658';

    expect(pipe.transform([id], { type: 'body' })).toEqual([id]);
    expect(() => pipe.transform([id, 'abc', '1'], { type: 'body' })).toThrow(
      new BadRequestException('Not a uuid: abc, 1')
    );
  });

  it('revert validates the ids as uuids', () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestRunsController, 'revert') as Record<
      string,
      { pipes: unknown[] }
    >;

    expect(Object.values(args).flatMap((arg) => arg.pipes)).toHaveLength(2);
  });

  describe('multipartLimits', () => {
    afterEach(() => {
      delete process.env.MULTIPART_FILE_SIZE_LIMIT;
    });

    it('defaults to 100 MiB', () => {
      expect(multipartLimits()).toEqual({ fileSize: 104857600 });
    });

    it('reads the limit from the environment on every call', () => {
      process.env.MULTIPART_FILE_SIZE_LIMIT = '1000';

      expect(multipartLimits()).toEqual({ fileSize: 1000 });
    });

    it('falls back to the default for a value that is not a number', () => {
      process.env.MULTIPART_FILE_SIZE_LIMIT = 'abc';

      expect(multipartLimits()).toEqual({ fileSize: 104857600 });
    });

    it('falls back to the default for a negative value', () => {
      process.env.MULTIPART_FILE_SIZE_LIMIT = '-1';

      expect(multipartLimits()).toEqual({ fileSize: 104857600 });
    });
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

    it.each(['approveTestRun', 'reject', 'revert', 'delete', 'updateIgnoreAreas', 'addIgnoreAreas', 'update'] as const)(
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

    it('moves the uploaded image into the body; the DTO carries its own validation options', () => {
      const method = TestRunsController.prototype.postTestRunMultipart;
      const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, method);

      expect(interceptors).toHaveLength(2);
      expect(interceptors[1]).toBe(FileToBodyInterceptor);
      expect(Reflect.getMetadata(PIPES_METADATA, method)).toBeUndefined();
    });
  });
});
