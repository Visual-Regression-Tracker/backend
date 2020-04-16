import { Dialect } from 'sequelize/types';

export const config = {
  db: {
    dialect: 'postgres' as Dialect,
    host: process.env.DATABASE_HOST,
    port: +process.env.DATABASE_PORT,
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_DATABASE,
    logging: false,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    signOptions: { expiresIn: process.env.JWT_LIFE_TIME },
  },
};
