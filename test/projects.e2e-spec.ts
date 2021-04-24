import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { requestWithAuth, haveUserLogged } from './preconditions';
import { ProjectsService } from '../src/projects/projects.service';
import uuidAPIKey from 'uuid-apikey';
import { UserLoginResponseDto } from 'src/users/dto/user-login-response.dto';

const project = {
  id: uuidAPIKey.create().uuid,
  name: 'Test project',
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
  let loggedUser: UserLoginResponseDto;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProjectsService)
      .useValue(projectServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    usersService = moduleFixture.get<UsersService>(UsersService);

    await app.init();
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

  describe('POST /', () => {
    it('200', () => {
      return requestWithAuth(app, 'post', '/projects', loggedUser.token)
        .send(project)
        .expect(201)
        .expect((res) => {
          expect(res.body.name).toBe(project.name);
        });
    });

    it('401', () => {
      return requestWithAuth(app, 'post', '/projects', '').send(project).expect(401);
    });
  });

  describe('GET /', () => {
    it('200', async () => {
      const res = await requestWithAuth(app, 'get', '/projects', loggedUser.token).send().expect(200);

      expect(res.body).toEqual(expect.arrayContaining(projectServiceMock.findAll()));
    });

    it('401', async () => {
      await requestWithAuth(app, 'get', '/projects', '').send().expect(401);
    });
  });

  describe('DELETE /', () => {
    it('can delete', async () => {
      const res = await requestWithAuth(app, 'delete', `/projects/${project.id}`, loggedUser.token).send().expect(200);

      expect(res.body).toStrictEqual(projectServiceMock.remove());
    });

    it('not valid UUID', async () => {
      await requestWithAuth(app, 'delete', `/projects/123`, loggedUser.token).send().expect(400);
    });

    it('not valid token', async () => {
      await requestWithAuth(app, 'delete', `/projects/${project.id}`, 'asd').send().expect(401);
    });
  });

  describe('PUT /', () => {
    it('can edit', async () => {
      const res = await requestWithAuth(app, 'put', `/projects`, loggedUser.token).send(project).expect(200);

      expect(res.body).toStrictEqual(projectServiceMock.update());
    });

    it('not valid token', async () => {
      await requestWithAuth(app, 'put', `/projects`, 'asd').send(project).expect(401);
    });
  });
});
