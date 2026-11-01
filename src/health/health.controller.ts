import { Controller, Get } from '@nestjs/common';
import { HealthCheckService, HealthCheck, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

const DATABASE_TIMEOUT_MS = 3_000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prismaService: PrismaService
  ) {}

  @Get()
  @ApiOkResponse({ type: Object })
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prismaService, { timeout: DATABASE_TIMEOUT_MS }),
    ]);
  }
}
