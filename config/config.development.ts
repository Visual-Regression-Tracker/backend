import { JwtModuleOptions } from '@nestjs/jwt';

const jwt: JwtModuleOptions = {
  secret: 'jwtPrivateKey',
  signOptions: { expiresIn: '1d' },
};

const image = {
  uploadPath: 'imageUploads/'
}

const app = {
  port: 4200,
  frontendUrl: 'http://localhost:3000'
}

export const config = {
  jwt,
  image,
  app,
};
