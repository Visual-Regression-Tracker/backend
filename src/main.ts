import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import * as bodyParser from 'body-parser';
import { readFileSync, existsSync } from 'fs';
import { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import { IMAGE_PATH } from './shared/static/static.service';
import { NestExpressApplication } from '@nestjs/platform-express';

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

  if (process.env.BODY_PARSER_JSON_LIMIT) {
    app.use(bodyParser.json({ limit: process.env.BODY_PARSER_JSON_LIMIT }));
  }

  // serve images
  app.useStaticAssets(join(process.cwd(), IMAGE_PATH), {
    maxAge: 31536000,
    // allow cors
    setHeaders: (res) => {
      res.set('Access-Control-Allow-Origin', '*');
    },
  });

  await app.listen(process.env.APP_PORT || 3000);
}
bootstrap();
