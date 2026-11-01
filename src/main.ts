import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';
import { Logger } from '@nestjs/common';
import { join } from 'path';
import compression from 'compression';
import { NestExpressApplication } from '@nestjs/platform-express';
import { HDD_IMAGE_PATH } from './static/hdd/constants';
import { RedisIoAdapter } from './redis-io.adapter';
import { getHttpsOptions, parseLogLevels } from './main.helpers';
import { GlobalValidationPipe } from './shared/validation';

async function bootstrap() {
  const logger = parseLogLevels(process.env.LOG_LEVEL);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
    httpsOptions: getHttpsOptions(),
    abortOnError: false,
    ...(logger && { logger }),
  });
  app.useGlobalPipes(new GlobalValidationPipe());
  app.enableShutdownHooks();

  app.use(
    compression({ filter: (req, res) => compression.filter(req, res) && res.getHeader('Content-Type') !== 'image/png' })
  );

  setupSwagger(app);

  await RedisIoAdapter.use(app, process.env.REDIS_URL);

  if (process.env.BODY_PARSER_JSON_LIMIT) {
    app.useBodyParser('json', { limit: process.env.BODY_PARSER_JSON_LIMIT });
  }

  app.useStaticAssets(join(process.cwd(), HDD_IMAGE_PATH), {
    maxAge: 31536000,
    setHeaders: (res) => {
      res.set('Access-Control-Allow-Origin', '*');
    },
  });

  await app.listen(process.env.APP_PORT || 3000);
}
bootstrap().catch((error: unknown) => {
  Logger.error(
    `Failed to start: ${error instanceof Error ? error.message : String(error)}`,
    error instanceof Error ? error.stack : undefined
  );
  process.exit(1);
});
