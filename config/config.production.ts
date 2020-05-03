import { JwtModuleOptions } from '@nestjs/jwt';

const jwt: JwtModuleOptions = {
  secret: process.env.JWT_SECRET,
  signOptions: { expiresIn: process.env.JWT_LIFE_TIME },
};

const image = {
  uploadPath: process.env.IMG_UPLOAD_FOLDER 
}

const app = {
  port: +process.env.APP_PORT,
  frontendUrl: process.env.APP__FRONTEND_URL
}

export const config = {
  jwt,
  image,
  app,
};
