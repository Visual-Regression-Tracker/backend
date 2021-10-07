import { HttpModule, Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { VRTUserLogService } from '../shared/user-logs/user-log.service';

@Module({
  imports: [AuthModule, HttpModule],
  providers: [UsersService, PrismaService, VRTUserLogService],
  exports: [UsersService],
  controllers: [UsersController],
})
export class UsersModule { }
