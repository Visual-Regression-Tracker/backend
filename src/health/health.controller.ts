import { Controller, Get } from '@nestjs/common';
import { HealthCheckService, HealthCheck } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private health: HealthCheckService, private readonly prismaService: PrismaService) {}

  @Get()
  @ApiOkResponse({type: Object})
  @HealthCheck()
  check() {
    return this.health.check([() => this.prismaService.$queryRaw`SELECT 1`]);
  }
}
