import { Dialect } from 'sequelize/types';
import { SequelizeModuleOptions } from '@nestjs/sequelize';
import { JwtModuleOptions } from '@nestjs/jwt';

const db: SequelizeModuleOptions = {
  dialect: 'postgres' as Dialect,
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'postgres',
  database: 'vrt',
  autoLoadModels: true,
  synchronize: true,
};

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
  db,
  jwt,
  image,
  app,
};
