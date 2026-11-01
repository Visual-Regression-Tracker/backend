import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HttpExceptionFilter } from './http-exception.filter';

const createHost = (url = '/some/path') => {
  const response = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  response.status.mockReturnValue(response);
  const request = { url };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { host, response };
};

const prismaError = (code: string, message: string) =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: Prisma.prismaVersion.client });

const uniqueConstraintError = (method: string) =>
  prismaError(
    'P2002',
    `\nInvalid \`prisma.${method}\` invocation:\n\n\nUnique constraint failed on the fields: (\`name\`)`
  );

const prisma7UniqueConstraintError = (method: string, constraint: string) =>
  prismaError(
    'P2002',
    `\nInvalid \`this.prismaService.${method}\` invocation in\n/app/dist/x.js:1:1\n\n\nUnique constraint failed on the constraint: \`${constraint}\``
  );

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const catchWith = (exception: unknown, url?: string) => {
    const { host, response } = createHost(url);
    filter.catch(exception, host);
    return response;
  };

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe('catch', () => {
    it('answers an HttpException with its own status and a body without the exception or its stack', () => {
      const response = catchWith(new NotFoundException('Project not found'), '/projects/1');

      expect(response.status).toHaveBeenCalledWith(404);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: 404,
        path: '/projects/1',
        name: 'NotFoundException',
        message: 'Project not found',
      });
    });

    it('logs a 5xx at error with the stack', () => {
      const exception = new Error('Something broke');

      catchWith(exception, '/boom');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('500: Something broke'), exception.stack);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('logs a 4xx at warn without the stack', () => {
      catchWith(new BadRequestException('Bad input'), '/projects/1');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('400: Bad input'));
      expect(warnSpy.mock.calls[0]).toHaveLength(1);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('answers 500 for an error without getStatus', () => {
      const response = catchWith(new Error('Something broke'));

      expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: 500,
        path: '/some/path',
        name: 'Error',
        message: 'Something broke',
      });
    });

    it('answers 500 for a thrown string', () => {
      const response = catchWith('plain string');

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 500, name: 'Error', message: 'plain string' })
      );
    });

    it.each([
      ['an error with a status but no parser type', Object.assign(new Error('odd'), { status: 413 })],
      [
        'a typed error whose status is not a client error',
        Object.assign(new Error('odd'), { statusCode: 502, type: 'x' }),
      ],
      [
        'an exception whose getStatus throws',
        Object.assign(new HttpException('Weird', 418), {
          getStatus: () => {
            throw new Error('no status');
          },
        }),
      ],
    ])('answers 500 for %s', (_, exception) => {
      expect(catchWith(exception).status).toHaveBeenCalledWith(500);
    });

    it.each([
      ['a foreign key violation (P2003)', prismaError('P2003', 'Foreign key constraint violated.'), 409],
      ['no record to update or delete (P2025)', prismaError('P2025', 'No record was found for an update.'), 404],
    ])('answers %s with %i', (_, exception, status) => {
      const response = catchWith(exception);

      expect(response.status).toHaveBeenCalledWith(status);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: status, message: exception.message })
      );
    });

    it('sets Retry-After from retryAfterSeconds', () => {
      const response = catchWith(Object.assign(new ServiceUnavailableException('busy'), { retryAfterSeconds: 5 }));

      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '5');
      expect(response.status).toHaveBeenCalledWith(503);
    });

    it('sends no Retry-After without retryAfterSeconds', () => {
      expect(catchWith(new ServiceUnavailableException('busy')).setHeader).not.toHaveBeenCalled();
    });

    it('answers 413 for a body over the parser limit', () => {
      const response = catchWith(
        Object.assign(new Error('request entity too large'), {
          status: 413,
          statusCode: 413,
          type: 'entity.too.large',
        })
      );

      expect(response.status).toHaveBeenCalledWith(413);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: 413,
        path: '/some/path',
        name: 'Error',
        message: 'request entity too large',
      });
    });

    it('answers a ValidationPipe rejection with the validation messages', () => {
      const response = catchWith(
        new BadRequestException(['name should not be empty', 'imageComparisonConfig must be a json string'])
      );

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'name should not be empty, imageComparisonConfig must be a json string',
        })
      );
    });

    describe.each([
      ['Prisma 6', (method: string, _constraint: string) => uniqueConstraintError(method)],
      ['Prisma 7', prisma7UniqueConstraintError],
    ])('a unique constraint failure from %s', (_, build) => {
      it.each([
        ['build.update()', 'Build_projectId_ciBuildId_key', 'There is already a build with this ci build id.'],
        ['project.create()', 'Project_name_key', 'Project exists with this name.'],
        ['user.create()', 'User_email_key', 'This user already exists.'],
      ])('in %s answers 400 with a friendly message', (method, constraint, message) => {
        const response = catchWith(build(method, constraint));

        expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(response.json).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'PrismaClientKnownRequestError', message })
        );
      });
    });

    it('answers 400 with the raw Prisma message for a unique constraint failure on another model', () => {
      const exception = uniqueConstraintError('testVariation.create()');

      const response = catchWith(exception);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ message: exception.message }));
    });

    it('keeps the 403 status of a guard rejection and rewrites its message', () => {
      const response = catchWith(new ForbiddenException('Forbidden resource'));

      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ForbiddenException',
          message: 'You do not have permission to perform this operation.',
        })
      );
    });

    it('keeps the message of a non-403 error mentioning "Forbidden resource"', () => {
      const response = catchWith(new Error('Forbidden resource: storage bucket'));

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Forbidden resource: storage bucket' })
      );
    });
  });

  describe('isUniqueConstraintException', () => {
    it.each([
      ['the Prisma unique constraint message', uniqueConstraintError('user.create()'), true],
      ['other messages', new BadRequestException('nope'), false],
      [
        "Prisma 7's wording, which names the constraint instead of the fields",
        prisma7UniqueConstraintError('project.create()', 'Project_name_key'),
        true,
      ],
      ['the P2002 code whatever the message says', prismaError('P2002', 'reworded in some later version'), true],
      ['no other Prisma error code as a duplicate', prismaError('P2025', 'Record to update not found.'), false],
    ])('handles %s', (_, error, expected) => {
      expect(filter.isUniqueConstraintException(error)).toBe(expected);
    });
  });

  describe('isForbiddenException', () => {
    it.each([
      ['the message of a guard rejection', new ForbiddenException('Forbidden resource'), true],
      ['only a ForbiddenException with the guard message', new Error('Forbidden resource'), false],
      ['no ForbiddenException without a message', new ForbiddenException(undefined), false],
      ['no ForbiddenException with another message', new ForbiddenException('Admins only'), false],
    ])('handles %s', (_, error, expected) => {
      expect(filter.isForbiddenException(error)).toBe(expected);
    });
  });

  describe('getCustomMessageForException', () => {
    it.each([
      ['... build.update() ...', 'There is already a build with this ci build id.'],
      ['... project.create() ...', 'Project exists with this name.'],
      ['... user.create() ...', 'This user already exists.'],
      ['Forbidden resource', 'You do not have permission to perform this operation.'],
      ['anything else', 'anything else'],
      ['user.create() build.update() Forbidden resource', 'There is already a build with this ci build id.'],
    ])('maps %p to %p', (message, expected) => {
      expect(filter.getCustomMessageForException(new Error(message))).toBe(expected);
    });
  });
});
