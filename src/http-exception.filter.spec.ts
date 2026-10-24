import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HttpExceptionFilter } from './http-exception.filter';

const createHost = (url = '/some/path') => {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  const request = { url };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { host, response };
};

// the errors Prisma 7 raises through the pg adapter, as captured from PostgreSQL
const prisma7UniqueConstraintError = (method: string, constraint: string) =>
  new Prisma.PrismaClientKnownRequestError(
    `\nInvalid \`this.prismaService.${method}\` invocation in\n/app/dist/x.js:1:1\n\n\nUnique constraint failed on the constraint: \`${constraint}\``,
    { code: 'P2002', clientVersion: Prisma.prismaVersion.client }
  );

const uniqueConstraintError = (method: string) =>
  new Prisma.PrismaClientKnownRequestError(
    `\nInvalid \`prisma.${method}\` invocation:\n\n\nUnique constraint failed on the fields: (\`name\`)`,
    { code: 'P2002', clientVersion: Prisma.prismaVersion.client }
  );

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    loggerSpy = jest.spyOn(Logger, 'error').mockImplementation();
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  describe('catch', () => {
    it('answers an HttpException with its own status and the full JSON shape', () => {
      const { host, response } = createHost('/projects/1');
      const exception = new NotFoundException('Project not found');

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(404);
      expect(response.json).toHaveBeenCalledWith({
        path: '/projects/1',
        name: 'NotFoundException',
        message: 'Project not found',
        exception,
        stack: exception.stack,
      });
    });

    it('logs the exception with its stack and its response body', () => {
      const { host } = createHost();
      const exception = new BadRequestException('Bad input');

      filter.catch(exception, host);

      expect(loggerSpy).toHaveBeenCalledWith(exception, exception.stack, {
        message: 'Bad input',
        error: 'Bad Request',
        statusCode: 400,
      });
    });

    it('answers 500 for an error without getStatus and logs it without a response body', () => {
      const { host, response } = createHost();
      const exception = new Error('Something broke');

      filter.catch(exception as HttpException, host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Error', message: 'Something broke', exception })
      );
      expect(loggerSpy).toHaveBeenCalledWith(exception, exception.stack, undefined);
    });

    it('answers a ValidationPipe rejection with the validation messages', () => {
      const { host, response } = createHost();
      const exception = new BadRequestException([
        'name should not be empty',
        'imageComparisonConfig must be a json string',
      ]);

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'name should not be empty, imageComparisonConfig must be a json string',
        })
      );
    });

    it('answers 500 when getStatus itself throws', () => {
      const { host, response } = createHost();
      const exception = new HttpException('Weird', 418);
      jest.spyOn(exception, 'getStatus').mockImplementation(() => {
        throw new Error('no status');
      });

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(500);
    });

    it.each([
      ['build.update()', 'There is already a build with this ci build id.'],
      ['project.create()', 'Project exists with this name.'],
      ['user.create()', 'This user already exists.'],
    ])('answers 400 with a friendly message for a unique constraint failure in %s', (method, message) => {
      const { host, response } = createHost();
      const exception = uniqueConstraintError(method);

      filter.catch(exception as unknown as HttpException, host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'PrismaClientKnownRequestError', message, exception })
      );
    });

    it('answers 400 with the raw Prisma message for a unique constraint failure on another model', () => {
      const { host, response } = createHost();
      const exception = uniqueConstraintError('testVariation.create()');

      filter.catch(exception as unknown as HttpException, host);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ message: exception.message }));
    });

    // the exception Nest throws when a guard returns false
    it('keeps the 403 status of a guard rejection and rewrites its message', () => {
      const { host, response } = createHost();

      filter.catch(new ForbiddenException('Forbidden resource'), host);

      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ForbiddenException',
          message: 'You do not have permission to perform this operation.',
        })
      );
    });

    // NOTE: current behavior — the "forbidden" rewrite is keyed on the message
    // text only, so any error mentioning "Forbidden resource" is reworded while
    // keeping its original status.
    it('rewrites the message of a non-403 error that mentions "Forbidden resource"', () => {
      const { host, response } = createHost();

      filter.catch(new Error('Forbidden resource: storage bucket') as HttpException, host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'You do not have permission to perform this operation.' })
      );
    });

    // NOTE: current behavior — a thrown value without a string `message` (a
    // thrown string, or an object literal) crashes the filter itself with a
    // TypeError instead of producing a 500 response.
    it('throws a TypeError for a thrown value without a message', () => {
      const { host, response } = createHost();

      expect(() => filter.catch('plain string' as unknown as HttpException, host)).toThrow(TypeError);
      expect(response.status).not.toHaveBeenCalled();
    });
  });

  describe('isUniqueConstraintException', () => {
    it('detects the Prisma unique constraint message', () => {
      expect(filter.isUniqueConstraintException(uniqueConstraintError('user.create()') as never)).toBe(true);
    });

    it('ignores other messages', () => {
      expect(filter.isUniqueConstraintException(new BadRequestException('nope'))).toBe(false);
    });

    it("detects Prisma 7's wording, which names the constraint instead of the fields", () => {
      expect(
        filter.isUniqueConstraintException(
          prisma7UniqueConstraintError('project.create()', 'Project_name_key') as never
        )
      ).toBe(true);
    });

    it('detects the P2002 code whatever the message says', () => {
      const error = new Prisma.PrismaClientKnownRequestError('reworded in some later version', {
        code: 'P2002',
        clientVersion: Prisma.prismaVersion.client,
      });

      expect(filter.isUniqueConstraintException(error as never)).toBe(true);
    });

    it('does not take another Prisma error code for a duplicate', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
        code: 'P2025',
        clientVersion: Prisma.prismaVersion.client,
      });

      expect(filter.isUniqueConstraintException(error as never)).toBe(false);
    });
  });

  describe.each([
    ['build.update()', 'Build_projectId_ciBuildId_key', 'There is already a build with this ci build id.'],
    ['project.create()', 'Project_name_key', 'Project exists with this name.'],
    ['user.create()', 'User_email_key', 'This user already exists.'],
  ])('a Prisma 7 duplicate from %s', (method, constraint, message) => {
    it(`answers 400 "${message}"`, () => {
      const { host, response } = createHost();

      filter.catch(prisma7UniqueConstraintError(method, constraint) as never, host);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ message }));
    });
  });

  describe('isForbiddenException', () => {
    it('detects the message of a guard rejection', () => {
      expect(filter.isForbiddenException(new ForbiddenException('Forbidden resource'))).toBe(true);
    });

    // NOTE: current behavior — detection is by message text only, so a
    // ForbiddenException thrown by application code ("Forbidden" by default,
    // or a custom message) is not recognised and keeps its message.
    it.each([undefined, 'Admins only'])('does not detect a ForbiddenException with message %p', (message) => {
      expect(filter.isForbiddenException(new ForbiddenException(message))).toBe(false);
    });
  });

  describe('getCustomMessageForException', () => {
    it.each([
      ['... build.update() ...', 'There is already a build with this ci build id.'],
      ['... project.create() ...', 'Project exists with this name.'],
      ['... user.create() ...', 'This user already exists.'],
      ['Forbidden resource', 'You do not have permission to perform this operation.'],
      ['anything else', 'anything else'],
    ])('maps %p to %p', (message, expected) => {
      expect(filter.getCustomMessageForException(new Error(message) as HttpException)).toBe(expected);
    });

    it('prefers the build message when several markers are present', () => {
      expect(
        filter.getCustomMessageForException(new Error('user.create() build.update() Forbidden resource') as never)
      ).toBe('There is already a build with this ci build id.');
    });
  });
});
