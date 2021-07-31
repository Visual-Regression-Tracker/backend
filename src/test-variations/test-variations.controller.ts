import { Controller, ParseUUIDPipe, Get, UseGuards, Param, Query, Delete } from '@nestjs/common';
import { ApiTags, ApiParam, ApiBearerAuth, ApiQuery, ApiOkResponse } from '@nestjs/swagger';
import { TestVariationsService } from './test-variations.service';
import { TestVariation, Baseline, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { BuildDto } from '../builds/dto/build.dto';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../shared/roles.decorator';

@ApiTags('test-variations')
@Controller('test-variations')
export class TestVariationsController {
  constructor(private testVariations: TestVariationsService, private prismaService: PrismaService) { }

  @Get()
  @ApiQuery({ name: 'projectId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getList(@Query('projectId', new ParseUUIDPipe()) projectId: string): Promise<TestVariation[]> {
    return this.prismaService.testVariation.findMany({
      where: { projectId },
    });
  }

  @Get('details/:id')
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getDetails(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestVariation & { baselines: Baseline[] }> {
    return this.testVariations.getDetails(id);
  }

  @Get('merge/')
  @ApiQuery({ name: 'projectId', required: true })
  @ApiQuery({ name: 'fromBranch', required: true })
  @ApiQuery({ name: 'toBranch', required: true })
  @ApiOkResponse({ type: BuildDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  merge(
    @Query('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('fromBranch') fromBranch: string,
    @Query('toBranch') toBranch: string
  ): Promise<BuildDto> {
    return this.testVariations.merge(projectId, fromBranch, toBranch);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  delete(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestVariation> {
    return this.testVariations.delete(id);
  }
}
