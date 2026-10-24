import { Test, TestingModule } from '@nestjs/testing';
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
  };

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

  it('should be defined', () => {
    expect(controller).toBeDefined();
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
});
