import { Controller, ParseUUIDPipe, Get, UseGuards, Param, Query } from '@nestjs/common';
import { ApiTags, ApiParam, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TestVariationsService } from './test-variations.service';
import { TestVariation } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/guards/auth.guard';
import { PrismaService } from 'src/prisma/prisma.service';

@ApiTags('test-variations')
@Controller('test-variations')
export class TestVariationsController {
  constructor(private testVariations: TestVariationsService, private prismaService: PrismaService) { }

  @Get()
  @ApiQuery({ name: 'projectId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getList(
    @Query('projectId', new ParseUUIDPipe()) projectId,
  ): Promise<TestVariation[]> {
    return this.prismaService.testVariation.findMany({
      where: { projectId }
    });
  }
}
