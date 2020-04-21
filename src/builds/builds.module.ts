import { Module } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { BuildsController } from './builds.controller';
import { Build } from './build.entity';
import { SequelizeModule } from '@nestjs/sequelize';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [SequelizeModule.forFeature([Build]), UsersModule],
  providers: [BuildsService],
  controllers: [BuildsController]
})
export class BuildsModule {}
