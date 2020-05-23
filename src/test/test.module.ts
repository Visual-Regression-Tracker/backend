import { Module } from '@nestjs/common';
import { TestService } from './test.service';
import { TestController } from './test.controller';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { TestVariationsModule } from '../test-variations/test-variations.module';
import { UsersModule } from '../users/users.module';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [TestRunsModule, TestVariationsModule, UsersModule],
  providers: [TestService, PrismaService],
  controllers: [TestController],
  exports: [TestService]
})
export class TestModule {}
