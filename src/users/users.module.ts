import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { UsersFactoryService } from './users.factory';

@Module({
  imports: [AuthModule],
  providers: [UsersService, UsersFactoryService],
  exports: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
