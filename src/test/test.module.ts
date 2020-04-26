import { Module } from '@nestjs/common';
import { TestService } from './test.service';
import { TestController } from './test.controller';
import { SharedModule } from 'src/shared/shared.module';
import { UsersModule } from 'src/users/users.module';
import { TestRunsModule } from 'src/test-runs/test-runs.module';
import { TestVariationsModule } from 'src/test-variations/test-variations.module';

@Module({
  imports: [SharedModule, UsersModule, TestRunsModule, TestVariationsModule],
  providers: [TestService],
  controllers: [TestController],
  exports: [TestService]
})
export class TestModule {}
