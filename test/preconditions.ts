import { INestApplication } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import uuidAPIKey from 'uuid-apikey';
import request, { Test } from 'supertest';
import { BuildsService } from 'src/builds/builds.service';
import { TestRunsService } from 'src/test-runs/test-runs.service';
import { readFileSync } from 'fs';
import { TestRunResultDto } from 'src/test-runs/dto/testRunResult.dto';
import { Build, Role } from '@prisma/client';
import { CreateUserDto } from 'src/users/dto/user-create.dto';
import { UserLoginResponseDto } from 'src/users/dto/user-login-response.dto';

/** A signed-in user: login always issues a token, only creating a user answers without one. */
export type LoggedUser = UserLoginResponseDto & { token: string };

export const generateUser = (password: string): CreateUserDto => ({
  email: `email+${uuidAPIKey.create().apiKey.toLocaleLowerCase()}@example.com`,
  password,
  firstName: 'fName',
  lastName: 'lName',
});

export const requestWithAuth = (
  app: INestApplication,
  method: 'post' | 'get' | 'put' | 'delete' | 'patch',
  url: string,
  token: string
): Test =>
  request(app.getHttpServer())
    [method](url)
    .set('Authorization', 'Bearer ' + token);

export const requestWithApiKey = (
  app: INestApplication,
  method: 'post' | 'get' | 'put' | 'delete' | 'patch',
  url: string,
  apiKey: string
): Test => request(app.getHttpServer())[method](url).set('apiKey', apiKey);

export const haveUserLogged = async (usersService: UsersService, role: Role = 'admin'): Promise<LoggedUser> => {
  const password = '123456';
  const user = await usersService.create(generateUser(password));

  await usersService.assignRole({ id: user.id, role });

  return usersService.login({
    email: user.email,
    password,
  }) as Promise<LoggedUser>;
};

export const haveTestRunCreated = async (
  buildsService: BuildsService,
  testRunsService: TestRunsService,
  projectId: string,
  branchName: string,
  imagePath: string,
  merge?: boolean
): Promise<{ testRun: TestRunResultDto; build: Build }> => {
  const build = await buildsService.findOrCreate({ projectId: projectId, branchName });
  const testRun = await testRunsService.postTestRun({
    createTestRequestDto: {
      projectId: build.projectId,
      branchName: build.branchName!,
      buildId: build.id,
      name: 'Image name',
      merge,
    },
    imageBuffer: readFileSync(imagePath),
  });
  return {
    build,
    testRun,
  };
};
