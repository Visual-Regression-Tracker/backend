import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Project, Role } from '@prisma/client';
import request from 'supertest';
import uuidAPIKey from 'uuid-apikey';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';
import { TEST_PROJECT } from '../src/_data_';
import { haveUserLogged, requestWithAuth, LoggedUser } from './preconditions';

describe('Project favourites (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let projectsService: ProjectsService;
  let prismaService: PrismaService;
  const userIds: string[] = [];
  const projectIds: string[] = [];

  const haveUser = async (role: Role = Role.guest): Promise<LoggedUser> => {
    const user = await haveUserLogged(usersService, role);
    userIds.push(user.id);
    return user;
  };

  const haveProject = async (): Promise<Project> => {
    const project = await projectsService.create({ ...TEST_PROJECT, name: `Favourite ${uuidAPIKey.create().uuid}` });
    projectIds.push(project.id);
    return project;
  };

  const favoritesOf = async (user: LoggedUser): Promise<string[]> =>
    (await requestWithAuth(app, 'get', '/projects/favorites', user.token).expect(200)).body;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    usersService = moduleFixture.get(UsersService);
    projectsService = moduleFixture.get(ProjectsService);
    prismaService = moduleFixture.get(PrismaService);
    await app.init();
  });

  afterEach(async () => {
    // some tests delete their project or user already
    await prismaService.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } });
    await prismaService.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['get', '/projects/favorites'],
    ['put', `/projects/${uuidAPIKey.create().uuid}/favorite`],
    ['delete', `/projects/${uuidAPIKey.create().uuid}/favorite`],
  ] as const)('401 on %s %s without a token', (method, url) => request(app.getHttpServer())[method](url).expect(401));

  it('starts with no favourites', async () => {
    const user = await haveUser();

    await expect(favoritesOf(user)).resolves.toEqual([]);
  });

  it.each([Role.admin, Role.editor, Role.guest])('lets a %s add and remove a favourite', async (role) => {
    const user = await haveUser(role);
    const project = await haveProject();

    await requestWithAuth(app, 'put', `/projects/${project.id}/favorite`, user.token).expect(204);
    await expect(favoritesOf(user)).resolves.toEqual([project.id]);

    await requestWithAuth(app, 'delete', `/projects/${project.id}/favorite`, user.token).expect(204);
    await expect(favoritesOf(user)).resolves.toEqual([]);
  });

  it('keeps a single favourite when it is added twice', async () => {
    const user = await haveUser();
    const project = await haveProject();

    await requestWithAuth(app, 'put', `/projects/${project.id}/favorite`, user.token).expect(204);
    await requestWithAuth(app, 'put', `/projects/${project.id}/favorite`, user.token).expect(204);

    await expect(favoritesOf(user)).resolves.toEqual([project.id]);
  });

  it('accepts removing a project that is not a favourite', async () => {
    const user = await haveUser();
    const project = await haveProject();

    await requestWithAuth(app, 'delete', `/projects/${project.id}/favorite`, user.token).expect(204);

    await expect(favoritesOf(user)).resolves.toEqual([]);
  });

  it('answers 404 for adding an unknown project', async () => {
    const user = await haveUser();

    await requestWithAuth(app, 'put', `/projects/${uuidAPIKey.create().uuid}/favorite`, user.token).expect(404);

    await expect(favoritesOf(user)).resolves.toEqual([]);
  });

  it('answers 204 for removing an unknown project', async () => {
    const user = await haveUser();

    await requestWithAuth(app, 'delete', `/projects/${uuidAPIKey.create().uuid}/favorite`, user.token).expect(204);
  });

  it('answers 400 for an id that is not a UUID', async () => {
    const user = await haveUser();

    await requestWithAuth(app, 'put', '/projects/123/favorite', user.token).expect(400);
  });

  it("keeps each user's favourites to themselves", async () => {
    const [alice, bob] = [await haveUser(), await haveUser()];
    const [first, second] = [await haveProject(), await haveProject()];

    await requestWithAuth(app, 'put', `/projects/${first.id}/favorite`, alice.token).expect(204);
    await requestWithAuth(app, 'put', `/projects/${second.id}/favorite`, bob.token).expect(204);

    await expect(favoritesOf(alice)).resolves.toEqual([first.id]);
    await expect(favoritesOf(bob)).resolves.toEqual([second.id]);
  });

  it('drops the favourite when the project is deleted', async () => {
    const user = await haveUser();
    const project = await haveProject();
    await requestWithAuth(app, 'put', `/projects/${project.id}/favorite`, user.token).expect(204);

    await projectsService.remove(project.id);

    await expect(favoritesOf(user)).resolves.toEqual([]);
  });

  it('drops the favourite when the user is deleted', async () => {
    const user = await haveUser();
    const project = await haveProject();
    await requestWithAuth(app, 'put', `/projects/${project.id}/favorite`, user.token).expect(204);

    await usersService.delete(user.id);

    const { favoritedBy } = await prismaService.project.findUniqueOrThrow({
      where: { id: project.id },
      include: { favoritedBy: true },
    });
    expect(favoritedBy).toEqual([]);
  });
});
