import { Dialect } from 'sequelize/types';
import { JwtModuleOptions } from '@nestjs/jwt';
import { SequelizeModuleOptions } from '@nestjs/sequelize';

const db: SequelizeModuleOptions = {
  dialect: 'postgres' as Dialect,
  host: process.env.DATABASE_HOST,
  port: +process.env.DATABASE_PORT,
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_DATABASE,
  logging: false,
  autoLoadModels: true,
  synchronize: true,
};

const jwt: JwtModuleOptions = {
  secret: process.env.JWT_SECRET,
  signOptions: { expiresIn: process.env.JWT_LIFE_TIME },
};

const image = {
  uploadPath: process.env.IMG_UPLOAD_FOLDER 
}

const app = {
  port: +process.env.APP_PORT
}

export const config = {
  db,
  jwt,
  image,
  app,
};
