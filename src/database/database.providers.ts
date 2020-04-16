import { Sequelize } from 'sequelize-typescript';
import { ConfigService } from '../shared/config/config.service';
import { User } from 'src/users/user.entity';

export const databaseProviders = [
  {
    provide: 'SEQUELIZE',
    useFactory: async (configService: ConfigService) => {
      const sequelize = new Sequelize(configService.dbConfig);
      sequelize.addModels([User]);
      await sequelize.sync();
      return sequelize;
    },
    inject: [ConfigService],
  },
];
