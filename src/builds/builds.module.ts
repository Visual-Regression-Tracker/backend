import { Module } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { BuildsController } from './builds.controller';
import { UsersModule } from 'src/users/users.module';
import { TestModule } from 'src/test/test.module';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  imports: [UsersModule, TestModule],
  providers: [BuildsService, PrismaService],
  controllers: [BuildsController],
  exports: [BuildsService],
})
export class BuildsModule {}
