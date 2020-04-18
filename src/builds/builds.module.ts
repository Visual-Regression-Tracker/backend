import { Module } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { BuildsController } from './builds.controller';
import { Build } from './build.entity';
import { SequelizeModule } from '@nestjs/sequelize';

@Module({
  imports: [SequelizeModule.forFeature([Build])],
  providers: [BuildsService],
  controllers: [BuildsController]
})
export class BuildsModule {}
