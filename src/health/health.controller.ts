import { Controller, Get } from '@nestjs/common';
import { HealthCheckService, HealthCheck, HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private readonly prismaService: PrismaService
  ) {}

  @Get()
  @ApiOkResponse({ type: Object })
  @HealthCheck()
  check() {
    // the raw query result has always been passed through as the indicator result
    return this.health.check([() => this.prismaService.$queryRaw<HealthIndicatorResult>`SELECT 1`]);
  }
}
