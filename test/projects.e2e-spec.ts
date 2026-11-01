import { INestApplication } from '@nestjs/common';
import { UsersService } from '../src/users/users.service';
import { createE2eApp } from './api-helpers';
import { requestWithAuth, haveUserLogged, LoggedUser } from './preconditions';
import { ProjectsService } from '../src/projects/projects.service';
import { randomUUID } from 'crypto';
import { ProjectDto } from 'src/projects/dto/project.dto';

const project: ProjectDto = {
  id: randomUUID(),
  name: 'Test project',
  buildsCounter: 0,
  mainBranchName: 'master',
  createdAt: new Date(),
  updatedAt: new Date(),
  autoApproveFeature: true,
  imageComparison: 'pixelmatch',
  maxBuildAllowed: 0,
  maxBranchLifetime: 0,
  imageComparisonConfig: '{}',
  bulkApproveVariations: false,
  bulkApproveGroupBy: 'customTags',
};

const projectServiceMock = {
  findAll: () => ['test'],
  create: () => project,
  remove: () => project,
  update: () => project,
};

describe('Projects (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let loggedUser: LoggedUser;

  beforeAll(async () => {
    const created = await createE2eApp({ overrides: [[ProjectsService, projectServiceMock]] });
    app = created.app;
    usersService = created.get(UsersService);
  });

  beforeEach(async () => {
    loggedUser = await haveUserLogged(usersService);
  });

  afterEach(async () => {
    await usersService.delete(loggedUser.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['post', '/projects', ''],
    ['get', '/projects', ''],
    ['delete', `/projects/${project.id}`, 'asd'],
    ['put', '/projects', 'asd'],
  ] as const)('%s %s answers 401 for token "%s"', (method, url, token) =>
    requestWithAuth(app, method, url, token).send(project).expect(401)
  );

  it('POST / creates a project', () => {
    return requestWithAuth(app, 'post', '/projects', loggedUser.token)
      .send(project)
      .expect(201)
      .expect((res) => {
        expect(res.body).toMatchObject({
          name: project.name,
          mainBranchName: project.mainBranchName,
          autoApproveFeature: project.autoApproveFeature,
          imageComparison: project.imageComparison,
          imageComparisonConfig: project.imageComparisonConfig,
          maxBuildAllowed: project.maxBuildAllowed,
          maxBranchLifetime: project.maxBranchLifetime,
        });
      });
  });

  it('GET / lists the projects', async () => {
    const res = await requestWithAuth(app, 'get', '/projects', loggedUser.token).send().expect(200);

    expect(res.body).toEqual(expect.arrayContaining(projectServiceMock.findAll()));
  });

  it('DELETE /:id removes the project', async () => {
    const res = await requestWithAuth(app, 'delete', `/projects/${project.id}`, loggedUser.token).send().expect(200);

    expect(res.body).toStrictEqual({
      ...projectServiceMock.remove(),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('DELETE /:id answers 400 for an id that is not a UUID', async () => {
    await requestWithAuth(app, 'delete', `/projects/123`, loggedUser.token).send().expect(400);
  });

  it('PUT / edits the project', async () => {
    const res = await requestWithAuth(app, 'put', `/projects`, loggedUser.token).send(project).expect(200);

    expect(res.body).toStrictEqual({
      ...projectServiceMock.update(),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });
});
