import { HttpModule, Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { UserLogsController } from "../../user-logs/user-logs.controller";
import { PrismaService } from "../../prisma/prisma.service";
import { VRTUserLogService } from "./user-log.service";

@Module({
  imports: [AuthModule, HttpModule],
  providers: [PrismaService, VRTUserLogService],
  exports: [VRTUserLogService],
  controllers: [UserLogsController],
})
export class UserLogsModule { }
