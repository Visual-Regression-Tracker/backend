import { INestApplication } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import uuidAPIKey from 'uuid-apikey';
import request, { Test } from 'supertest';

export const generateUser = (
  password: string
): { email: string; password: string; firstName: string; lastName: string } => ({
  email: `${uuidAPIKey.create().uuid}@example.com'`,
  password,
  firstName: 'fName',
  lastName: 'lName',
});

export const requestWithAuth = (
  app: INestApplication,
  method: 'post' | 'get' | 'put' | 'delete',
  url: string,
  body = {},
  token: string
): Test =>
  request(app.getHttpServer())
    [method](url)
    .set('Authorization', 'Bearer ' + token)
    .send(body);

export const requestWithApiKey = (
  app: INestApplication,
  method: 'post' | 'get' | 'put' | 'delete',
  url: string,
  body = {},
  apiKey: string
): Test =>
  request(app.getHttpServer())
    [method](url)
    .set('apiKey', apiKey)
    .send(body);

export const haveUserLogged = async (usersService: UsersService) => {
  const password = '123456';
  const user = await usersService.create(generateUser(password));

  return usersService.login({
    email: user.email,
    password,
  });
};
