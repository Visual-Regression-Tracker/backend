import { INestApplication } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import uuidAPIKey from 'uuid-apikey';
import request, { Test } from 'supertest';
import { BuildsService } from 'src/builds/builds.service';
import { TestRunsService } from 'src/test-runs/test-runs.service';
import { readFileSync } from 'fs';
import { TestRunResultDto } from 'src/test-runs/dto/testRunResult.dto';

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
  method: 'post' | 'get' | 'put' | 'delete' | 'patch',
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
  method: 'post' | 'get' | 'put' | 'delete' | 'patch',
  url: string,
  body = {},
  apiKey: string
): Test => request(app.getHttpServer())[method](url).set('apiKey', apiKey).send(body);

export const haveUserLogged = async (usersService: UsersService) => {
  const password = '123456';
  const user = await usersService.create(generateUser(password));

  return usersService.login({
    email: user.email,
    password,
  });
};

export const haveTestRunCreated = async (
  buildsService: BuildsService,
  testRunsService: TestRunsService,
  projectId: string,
  branchName: string,
  imagePath: string
): Promise<TestRunResultDto> => {
  const build = await buildsService.create({ project: projectId, branchName });
  return testRunsService.postTestRun({
    projectId: build.projectId,
    branchName: build.branchName,
    imageBase64: readFileSync(imagePath).toString('base64'),
    buildId: build.id,
    name: 'Image name',
    merge: false,
  });
};
