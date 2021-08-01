import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import uuidAPIKey from 'uuid-apikey';
import { UsersService } from '../src/users/users.service';
import { CreateUserDto } from '../src/users/dto/user-create.dto';
import { UserLoginRequestDto } from '../src/users/dto/user-login-request.dto';
import { compareSync } from 'bcryptjs';
import { requestWithAuth, generateUser } from './preconditions';
import { UserLoginResponseDto } from 'src/users/dto/user-login-response.dto';
import { User } from '@prisma/client';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let user: Partial<User>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    usersService = moduleFixture.get<UsersService>(UsersService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await usersService.delete(user.id);
  });

  it('POST /register', () => {
    user = {
      email: `${uuidAPIKey.create().uuid}@example.com'`,
      password: '123456',
      firstName: 'fName',
      lastName: 'lName',
    };
    return request(app.getHttpServer())
      .post('/users/register')
      .send(user)
      .expect(201)
      .expect((res) => {
        expect(res.body.email).toBe(user.email);
        expect(res.body.firstName).toBe(user.firstName);
        expect(res.body.lastName).toBe(user.lastName);
        expect(res.body.apiKey).not.toBeNull();
        user.id = res.body.id;
      });
  });

  it('POST /login', async () => {
    const password = '123456';
    user = await usersService.create(generateUser(password));
    const loginData: UserLoginRequestDto = {
      email: user.email,
      password,
    };

    return request(app.getHttpServer())
      .post('/users/login')
      .send(loginData)
      .expect(201)
      .expect((res) => {
        expect(res.body.id).toBe(user.id);
        expect(res.body.email).toBe(user.email);
        expect(res.body.firstName).toBe(user.firstName);
        expect(res.body.lastName).toBe(user.lastName);
        expect(res.body.apiKey).toBe(user.apiKey);
        expect(res.body.token).not.toBeNull();
      });
  });

  it('GET /newApiKey', async () => {
    const password = '123456';
    user = await usersService.create(generateUser(password));
    const loggedUser = await usersService.login({
      email: user.email,
      password,
    });

    const res = await requestWithAuth(app, 'get', '/users/newApiKey', loggedUser.token).send().expect(200);

    const newUser = await usersService.findOne(user.id);
    expect(res.text).not.toBe(user.apiKey);
    expect(res.text).toBe(newUser.apiKey);
  });

  it('PUT /password', async () => {
    const newPassword = 'newPassword';
    const password = '123456';
    user = await usersService.create(generateUser(password));
    const loggedUser = await usersService.login({
      email: user.email,
      password,
    });

    await requestWithAuth(app, 'put', '/users/password', loggedUser.token).send({ password: newPassword }).expect(200);

    const newUser = await usersService.findOne(user.id);
    expect(compareSync(newPassword, newUser.password)).toBe(true);
  });

  it('PUT /', async () => {
    const password = '123456';
    user = await usersService.create(generateUser(password));
    const editedUser = {
      email: `${uuidAPIKey.create().uuid}@example.com'`,
      firstName: 'EDITEDfName',
      lastName: 'EDITEDlName',
    };

    const loggedUser = await usersService.login({
      email: user.email,
      password,
    });

    const res = await requestWithAuth(app, 'put', '/users', loggedUser.token).send(editedUser).expect(200);

    expect(res.body.id).toBe(user.id);
    expect(res.body.email).toBe(editedUser.email);
    expect(res.body.firstName).toBe(editedUser.firstName);
    expect(res.body.lastName).toBe(editedUser.lastName);
    expect(res.body.apiKey).toBe(user.apiKey);
    expect(res.body.token).not.toBeNull();
  });
});
