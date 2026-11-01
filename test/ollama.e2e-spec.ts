import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import request from 'supertest';
import { UsersService } from '../src/users/users.service';
import { OllamaService } from '../src/compare/libs/vlm/providers/ollama/ollama.service';
import { createE2eApp } from './api-helpers';
import { haveUserLogged, requestWithApiKey, requestWithAuth } from './preconditions';

const image = './test/image.png';
const compareUrl = '/ollama/compare?model=gemma3:12b&prompt=compare&temperature=0.1';

describe('Ollama (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  const userIds: string[] = [];
  const ollamaServiceMock = {
    listModels: jest.fn().mockResolvedValue([{ name: 'gemma3:12b' }]),
    generate: jest.fn().mockResolvedValue({ content: '{"identical":true}' }),
  };

  const loggedUserToken = async (role: Role): Promise<string> => {
    const user = await haveUserLogged(usersService, role);
    userIds.push(user.id);
    return user.token;
  };

  beforeAll(async () => {
    const created = await createE2eApp({ validation: false, overrides: [[OllamaService, ollamaServiceMock]] });
    app = created.app;
    usersService = created.get(UsersService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(userIds.splice(0).map((id) => usersService.delete(id)));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /ollama/models', () => {
    it('401 without authentication', async () => {
      await request(app.getHttpServer()).get('/ollama/models').expect(401);
      expect(ollamaServiceMock.listModels).not.toHaveBeenCalled();
    });

    it('401 with an api key only', async () => {
      const user = await haveUserLogged(usersService);
      userIds.push(user.id);

      await requestWithApiKey(app, 'get', '/ollama/models', user.apiKey).expect(401);
    });

    it('403 for a guest', async () => {
      await requestWithAuth(app, 'get', '/ollama/models', await loggedUserToken(Role.guest)).expect(403);
      expect(ollamaServiceMock.listModels).not.toHaveBeenCalled();
    });

    it.each([Role.admin, Role.editor])('200 for %s', async (role) => {
      await requestWithAuth(app, 'get', '/ollama/models', await loggedUserToken(role))
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({ models: [{ name: 'gemma3:12b' }] });
        });
    });
  });

  describe('POST /ollama/compare', () => {
    it('401 without authentication', async () => {
      await request(app.getHttpServer()).post(compareUrl).expect(401);
      expect(ollamaServiceMock.generate).not.toHaveBeenCalled();
    });

    it('403 for a guest', async () => {
      await requestWithAuth(app, 'post', compareUrl, await loggedUserToken(Role.guest)).expect(403);
      expect(ollamaServiceMock.generate).not.toHaveBeenCalled();
    });

    it.each([Role.admin, Role.editor])('201 for %s', async (role) => {
      await requestWithAuth(app, 'post', compareUrl, await loggedUserToken(role))
        .attach('images', image)
        .attach('images', image)
        .expect(201)
        .expect((res) => {
          expect(res.body).toEqual({ content: '{"identical":true}' });
        });
      expect(ollamaServiceMock.generate).toHaveBeenCalledWith(
        { provider: 'ollama', model: 'gemma3:12b', prompt: 'compare', temperature: 0.1 },
        [expect.any(Uint8Array), expect.any(Uint8Array)]
      );
    });
  });
});
