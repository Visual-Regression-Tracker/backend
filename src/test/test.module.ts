import { Module } from '@nestjs/common';
import { TestService } from './test.service';
import { TestController } from './test.controller';
import { TestRunsModule } from 'src/test-runs/test-runs.module';
import { TestVariationsModule } from 'src/test-variations/test-variations.module';
import { UsersModule } from 'src/users/users.module';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  imports: [TestRunsModule, TestVariationsModule, UsersModule],
  providers: [TestService, PrismaService],
  controllers: [TestController],
  exports: [TestService]
})
export class TestModule {}
