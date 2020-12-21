import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { BuildsService } from '../builds/builds.service';
import { HttpException, HttpStatus } from '@nestjs/common';

const initService = async ({ projectFindUniqueMock = jest.fn() }) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProjectsService,
      {
        provide: PrismaService,
        useValue: {
          project: {
            findUnique: projectFindUniqueMock,
          },
        },
      },
      { provide: TestVariationsService, useValue: {} },
      { provide: BuildsService, useValue: {} },
    ],
  }).compile();

  return module.get<ProjectsService>(ProjectsService);
};
describe('ProjectsService', () => {
  let service: ProjectsService;

  describe('findOne', () => {
    it.each([
      ['name', 'someName', { id: undefined, name: 'someName' }],
      ['id', 'a9385fc1-884d-4f9f-915e-40da0e7773d5', { id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5', name: undefined }],
    ])('should find by %s', async (_, query, expected) => {
      const projectFindUniqueMock = jest.fn().mockResolvedValue({});
      service = await initService({ projectFindUniqueMock });

      await service.findOne(query);

      expect(projectFindUniqueMock).toHaveBeenCalledWith({
        where: expected,
      });
    });

    it('should throw exception if not found', async () => {
      const projectFindUniqueMock = jest.fn().mockResolvedValueOnce(undefined);
      service = await initService({ projectFindUniqueMock });

      await expect(service.findOne('foo')).rejects.toThrowError(
        new HttpException('Project not found', HttpStatus.NOT_FOUND)
      );
    });
  });
});
