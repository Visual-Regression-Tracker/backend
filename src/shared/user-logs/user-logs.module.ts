import { HttpModule, Module } from "@nestjs/common";
import { AuthModule } from "src/auth/auth.module";
import { UserLogsController } from "src/user-logs/user-logs.controller";
import { PrismaService } from "src/prisma/prisma.service";
import { VRTUserLogService } from "./user-log.service";

@Module({
  imports: [AuthModule, HttpModule],
  providers: [PrismaService, VRTUserLogService],
  exports: [VRTUserLogService],
  controllers: [UserLogsController],
})
export class UserLogsModule { }
