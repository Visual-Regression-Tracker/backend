import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../../auth/guards/auth.guard';
import { RoleGuard } from '../../../auth/guards/role.guard';
import { Roles } from '../../../shared/roles.decorator';
import { Dinov2Service, Dinov2Status } from './dinov2.service';

@ApiTags('DINOv2')
@Controller('dinov2')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.admin, Role.editor)
export class Dinov2Controller {
  constructor(private readonly dinov2Service: Dinov2Service) {}

  @Get('status')
  status(): Promise<Dinov2Status> {
    return this.dinov2Service.status();
  }
}
