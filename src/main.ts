import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import * as bodyParser from 'body-parser';
import { readFileSync, existsSync } from 'fs';
import { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import { NestExpressApplication } from '@nestjs/platform-express';
import { HDD_IMAGE_PATH } from './static/hdd/constants';
import { RedisIoAdapter } from './redis-io.adapter';

function getHttpsOptions(): HttpsOptions | null {
  const keyPath = './secrets/ssl.key';
  const certPath = './secrets/ssl.cert';
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    Logger.log('HTTPS config not found. Fall back to HTTP');
    return null;
  }
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
    httpsOptions: getHttpsOptions(),
  });
  app.useGlobalPipes(new ValidationPipe());
  setupSwagger(app);

  // Fan out socket.io events across API instances when running multiple
  // replicas. Without REDIS_URL the default in-memory adapter is used.
  if (process.env.REDIS_URL) {
    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis(process.env.REDIS_URL);
    app.useWebSocketAdapter(redisIoAdapter);
    Logger.log('Socket.io Redis adapter enabled');
  } else {
    Logger.log('REDIS_URL not set — socket.io running with the in-memory adapter (single instance only)');
  }

  if (process.env.BODY_PARSER_JSON_LIMIT) {
    app.use(bodyParser.json({ limit: process.env.BODY_PARSER_JSON_LIMIT }));
  }

  app.useStaticAssets(join(process.cwd(), HDD_IMAGE_PATH), {
    maxAge: 31536000,
    // allow cors
    setHeaders: (res) => {
      res.set('Access-Control-Allow-Origin', '*');
    },
  });

  await app.listen(process.env.APP_PORT || 3000);
}
bootstrap();
