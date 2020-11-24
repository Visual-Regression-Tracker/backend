import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { join } from 'path';
import * as bodyParser from 'body-parser';
import { readFileSync } from 'fs';
import { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';

function getHttpsOptions(): HttpsOptions | null {
  let cert: Buffer, key: Buffer;
  try {
    key = readFileSync('./secrets/ssl.key');
  } catch (err) {
    Logger.error('./secrets/ssl.key not found', err.stack);
  }
  try {
    cert = readFileSync('./secrets/ssl.cert');
  } catch (err) {
    Logger.error('./secrets/ssl.cert not found', err.stack);
  }
  return {
    key,
    cert,
  };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: true,
    httpsOptions: getHttpsOptions(),
  });
  app.useGlobalPipes(new ValidationPipe());
  setupSwagger(app);

  if (process.env.BODY_PARSER_JSON_LIMIT) {
    app.use(bodyParser.json({ limit: process.env.BODY_PARSER_JSON_LIMIT }));
  }

  // serve images
  app.use(express.static(join(process.cwd(), process.env.IMG_UPLOAD_FOLDER || 'imageUploads/')));

  await app.listen(process.env.APP_PORT || 3000);
}
bootstrap();
