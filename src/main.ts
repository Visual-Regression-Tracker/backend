import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { join } from 'path';
import config from 'config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalPipes(new ValidationPipe());
  setupSwagger(app);

  // serve images
  app.use(express.static(join(process.cwd(), config.image.uploadPath)));

  await app.listen(config.app.port);
}
bootstrap();
