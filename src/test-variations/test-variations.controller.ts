import { Controller, ParseUUIDPipe, Get, UseGuards, Param, Query, Delete, Post, Body } from '@nestjs/common';
import {
  ApiTags,
  ApiParam,
  ApiBearerAuth,
  ApiQuery,
  ApiOkResponse,
  ApiOperation,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { TestVariationsService } from './test-variations.service';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { BuildDto } from '../builds/dto/build.dto';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../shared/roles.decorator';
import { MergeParams } from './types';
import { BaseTestVariationDto } from './dto/base-test-variation.dto';
import { TestVariationDto } from './dto/test-variation.dto';

@ApiTags('test-variations')
@Controller('test-variations')
export class TestVariationsController {
  constructor(
    private testVariations: TestVariationsService,
    private prismaService: PrismaService
  ) {}

  @Get()
  @ApiQuery({ name: 'projectId', required: true })
  @ApiOkResponse({ type: BaseTestVariationDto, isArray: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getList(@Query('projectId', new ParseUUIDPipe()) projectId: string): Promise<BaseTestVariationDto[]> {
    return this.prismaService.testVariation.findMany({
      where: { projectId },
    });
  }

  @Get('details/:id')
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ type: TestVariationDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getDetails(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestVariationDto> {
    return this.testVariations.getDetails(id);
  }

  @Get('merge/')
  @ApiOperation({ deprecated: true, description: 'Use POST /test-variations/merge' })
  @ApiOkResponse({ type: BuildDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  merge(@Query() params: MergeParams): Promise<BuildDto> {
    return this.mergeFromBody(params);
  }

  @Post('merge')
  @ApiCreatedResponse({ type: BuildDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  mergeFromBody(@Body() { projectId, fromBranch, toBranch }: MergeParams): Promise<BuildDto> {
    return this.testVariations.merge(projectId, fromBranch, toBranch);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ type: BaseTestVariationDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  delete(@Param('id', new ParseUUIDPipe()) id: string): Promise<BaseTestVariationDto> {
    return this.testVariations.delete(id);
  }
}
