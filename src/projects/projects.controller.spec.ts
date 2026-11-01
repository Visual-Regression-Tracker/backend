import { ExecutionContext, HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { User } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TEST_PROJECT } from '../_data_';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

describe('Projects Controller', () => {
  let controller: ProjectsController;
  const projectsService = {
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    findFavoriteIds: jest.fn(),
    addFavorite: jest.fn(),
    removeFavorite: jest.fn(),
  };
  const user = { id: 'b1e2c3d4-0000-4000-8000-000000000001', role: 'guest' } as User;
  const projectId = 'a9385fc1-884d-4f9f-915e-40da0e7773d5';

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectsService, useValue: projectsService },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<ProjectsController>(ProjectsController);
  });

  it('lists all projects', async () => {
    projectsService.findAll.mockResolvedValue([TEST_PROJECT]);

    await expect(controller.getAll()).resolves.toEqual([TEST_PROJECT]);
    expect(projectsService.findAll).toHaveBeenCalledWith();
  });

  it('creates a project from the body', async () => {
    const dto = { name: 'New project' } as CreateProjectDto;
    projectsService.create.mockResolvedValue(TEST_PROJECT);

    await expect(controller.create(dto)).resolves.toBe(TEST_PROJECT);
    expect(projectsService.create).toHaveBeenCalledWith(dto);
  });

  it('updates a project from the body', async () => {
    const dto = { id: TEST_PROJECT.id, name: 'Renamed' } as UpdateProjectDto;
    projectsService.update.mockResolvedValue(TEST_PROJECT);

    await expect(controller.update(dto)).resolves.toBe(TEST_PROJECT);
    expect(projectsService.update).toHaveBeenCalledWith(dto);
  });

  it('removes a project by id', async () => {
    projectsService.remove.mockResolvedValue(TEST_PROJECT);

    await expect(controller.remove('a9385fc1-884d-4f9f-915e-40da0e7773d5')).resolves.toBe(TEST_PROJECT);
    expect(projectsService.remove).toHaveBeenCalledWith('a9385fc1-884d-4f9f-915e-40da0e7773d5');
  });

  it("lists the current user's favourite project ids", async () => {
    projectsService.findFavoriteIds.mockResolvedValue([projectId]);

    await expect(controller.getFavorites(user)).resolves.toEqual([projectId]);
    expect(projectsService.findFavoriteIds).toHaveBeenCalledWith(user.id);
  });

  it('adds a project to the current user favourites', async () => {
    projectsService.addFavorite.mockResolvedValue(undefined);

    await expect(controller.addFavorite(user, projectId)).resolves.toBeUndefined();
    expect(projectsService.addFavorite).toHaveBeenCalledWith(user.id, projectId);
  });

  it('removes a project from the current user favourites', async () => {
    projectsService.removeFavorite.mockResolvedValue(undefined);

    await expect(controller.removeFavorite(user, projectId)).resolves.toBeUndefined();
    expect(projectsService.removeFavorite).toHaveBeenCalledWith(user.id, projectId);
  });

  describe('favourites over HTTP', () => {
    let app: INestApplication;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [ProjectsController],
        providers: [
          { provide: ProjectsService, useValue: projectsService },
          { provide: PrismaService, useValue: {} },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            context.switchToHttp().getRequest().user = user;
            return true;
          },
        })
        .compile();
      app = module.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('answers GET /projects/favorites with the id list rather than treating "favorites" as a project id', async () => {
      projectsService.findFavoriteIds.mockResolvedValue([projectId]);

      const response = await request(app.getHttpServer()).get('/projects/favorites');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([projectId]);
      expect(projectsService.findFavoriteIds).toHaveBeenCalledWith(user.id);
    });

    it('answers PUT /projects/:id/favorite with 204 and no body', async () => {
      projectsService.addFavorite.mockResolvedValue(undefined);

      const response = await request(app.getHttpServer()).put(`/projects/${projectId}/favorite`);

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      expect(projectsService.addFavorite).toHaveBeenCalledWith(user.id, projectId);
    });

    it('answers PUT /projects/:id/favorite with 404 for an unknown project', async () => {
      projectsService.addFavorite.mockRejectedValue(new HttpException('Project not found', HttpStatus.NOT_FOUND));

      const response = await request(app.getHttpServer()).put(`/projects/${projectId}/favorite`);

      expect(response.status).toBe(404);
    });

    it('answers DELETE /projects/:id/favorite with 204 and no body', async () => {
      projectsService.removeFavorite.mockResolvedValue(undefined);

      const response = await request(app.getHttpServer()).delete(`/projects/${projectId}/favorite`);

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      expect(projectsService.removeFavorite).toHaveBeenCalledWith(user.id, projectId);
    });

    it.each(['put', 'delete'] as const)('answers %s with 400 when the id is not a UUID', async (method) => {
      const response = await request(app.getHttpServer())[method]('/projects/123/favorite');

      expect(response.status).toBe(400);
      expect(projectsService.addFavorite).not.toHaveBeenCalled();
      expect(projectsService.removeFavorite).not.toHaveBeenCalled();
    });
  });
});
