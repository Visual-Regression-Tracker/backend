import { INestApplication } from '@nestjs/common';
import { User } from '@prisma/client';
import { compareSync } from 'bcryptjs';
import request from 'supertest';
import { UsersService } from '../src/users/users.service';
import { createE2eApp, withEnv } from './api-helpers';
import { generateUser, requestWithAuth } from './preconditions';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let user: Partial<User>;

  const password = '123456';
  const haveUserLoggedIn = async () => {
    user = await usersService.create(generateUser(password));
    return usersService.login({ email: user.email!, password });
  };
  const expectProfile = (body: Record<string, unknown>, expected: Partial<User>) => {
    expect(body).toMatchObject({
      id: expected.id,
      email: expected.email,
      firstName: expected.firstName,
      lastName: expected.lastName,
      apiKey: user.apiKey,
    });
    expect(body.token).not.toBeNull();
  };

  beforeAll(async () => {
    const { app: created, get } = await createE2eApp();
    app = created;
    usersService = get(UsersService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await usersService.delete(user.id!);
  });

  it('POST /register', () => {
    user = generateUser(password);
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

  it('GET /registration/enabled is true by default', async () => {
    user = await usersService.create(generateUser(password));

    await request(app.getHttpServer())
      .get('/users/registration/enabled')
      .expect(200)
      .expect('Content-Type', /application\/json/)
      .expect((res) => expect(res.body).toBe(true));
  });

  it('POST /register answers 403 when REGISTRATION_ENABLED=false', async () => {
    user = await usersService.create(generateUser(password));
    await withEnv({ REGISTRATION_ENABLED: 'false' }, async () => {
      await request(app.getHttpServer())
        .post('/users/register')
        .send(generateUser(password))
        .expect(403)
        .expect((res) => expect(res.body.message).toBe('User registration is disabled.'));
      await request(app.getHttpServer())
        .get('/users/registration/enabled')
        .expect(200)
        .expect((res) => expect(res.body).toBe(false));
    });
  });

  it('POST /login', async () => {
    user = await usersService.create(generateUser(password));

    await request(app.getHttpServer())
      .post('/users/login')
      .send({ email: user.email!, password })
      .expect(201)
      .expect((res) => expectProfile(res.body, user));
  });

  it('GET /newApiKey', async () => {
    const loggedUser = await haveUserLoggedIn();

    const res = await requestWithAuth(app, 'get', '/users/newApiKey', loggedUser.token!).send().expect(200);

    const newUser = (await usersService.findOne(user.id!))!;
    expect(res.text).not.toBe(user.apiKey);
    expect(res.text).toBe(newUser.apiKey);
  });

  it('PUT /password', async () => {
    const loggedUser = await haveUserLoggedIn();

    await requestWithAuth(app, 'put', '/users/password', loggedUser.token!)
      .send({ password: 'newPassword' })
      .expect(200);

    const newUser = (await usersService.findOne(user.id!))!;
    expect(compareSync('newPassword', newUser.password)).toBe(true);
  });

  it('PUT /password answers 400 for a body without password', async () => {
    const loggedUser = await haveUserLoggedIn();

    await requestWithAuth(app, 'put', '/users/password', loggedUser.token!).send({}).expect(400);
    await requestWithAuth(app, 'put', '/users/password', loggedUser.token!).send({ password: '' }).expect(400);

    const unchanged = (await usersService.findOne(user.id!))!;
    expect(compareSync(password, unchanged.password)).toBe(true);
  });

  it('PUT /', async () => {
    const loggedUser = await haveUserLoggedIn();
    const editedUser = { email: 'edited' + user.email, firstName: 'EDITEDfName', lastName: 'EDITEDlName' };

    const res = await requestWithAuth(app, 'put', '/users', loggedUser.token!).send(editedUser).expect(200);

    expectProfile(res.body, { id: user.id, ...editedUser });
  });

  it('a token keeps working after the user changes their email', async () => {
    const loggedUser = await haveUserLoggedIn();

    await requestWithAuth(app, 'put', '/users', loggedUser.token!)
      .send({ email: 'changed' + user.email, firstName: 'F', lastName: 'L' })
      .expect(200);

    const res = await requestWithAuth(app, 'get', '/users/me', loggedUser.token!).send().expect(200);
    expect(res.body.id).toBe(user.id);
    expect(res.body.email).toBe('changed' + user.email);
  });
});
