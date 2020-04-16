import { Dialect } from 'sequelize/types';

export const config = {
  db: {
    dialect: 'postgres' as Dialect,
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    password: 'postgres',
    database: 'nest',
    logging: false,
  },
  jwt: {
    secret: 'jwtPrivateKey',
    signOptions: { expiresIn: '60s' },
  },
};
