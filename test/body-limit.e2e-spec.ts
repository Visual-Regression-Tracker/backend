import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createE2eApp } from './api-helpers';

describe('JSON body limit (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createE2eApp({ configure: (created) => created.useBodyParser('json', { limit: '1kb' }) }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 413 with the usual error body for a JSON body over the limit', async () => {
    const res = await request(app.getHttpServer())
      .post('/users/login')
      .send({ email: 'someone@example.com', password: 'x'.repeat(2048) })
      .expect(413);

    expect(res.body).toEqual({
      statusCode: 413,
      path: '/users/login',
      name: 'PayloadTooLargeError',
      message: 'request entity too large',
    });
  });

  it('still answers a small body normally', async () => {
    await request(app.getHttpServer())
      .post('/users/login')
      .send({ email: 'nobody@example.com', password: 'x' })
      .expect((res) => expect(res.status).not.toBe(413));
  });
});
