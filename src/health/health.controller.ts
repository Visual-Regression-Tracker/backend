import { Controller, Get } from '@nestjs/common';
import { HealthCheckService, HealthCheck } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private readonly prismaService: PrismaService
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.prismaService.$queryRaw`SELECT 1`]);
  }
}
