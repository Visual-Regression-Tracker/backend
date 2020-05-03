import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalPipes(new ValidationPipe());
  setupSwagger(app);

  // serve images
  app.use(
    express.static(
      join(process.cwd(), process.env.IMG_UPLOAD_FOLDER || 'imageUploads/')
    )
  );

  await app.listen(process.env.APP_PORT || 3000);
}
bootstrap();
