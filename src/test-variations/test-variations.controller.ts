import { Controller, ParseUUIDPipe, Get, UseGuards, Param, Query, Put, Body, Delete } from '@nestjs/common';
import { ApiTags, ApiParam, ApiBearerAuth, ApiQuery, ApiOkResponse } from '@nestjs/swagger';
import { TestVariationsService } from './test-variations.service';
import { TestVariation, Baseline } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { IgnoreAreaDto } from '../test-runs/dto/ignore-area.dto';
import { CommentDto } from '../shared/dto/comment.dto';
import { BuildDto } from '../builds/dto/build.dto';
import { CustomTagsDto } from '../shared/dto/custom-tags.dto';

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

  @Put('ignoreArea/:variationId')
  @ApiParam({ name: 'variationId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateIgnoreAreas(
    @Param('variationId', new ParseUUIDPipe()) variationId: string,
    @Body() ignoreAreas: IgnoreAreaDto[]
  ): Promise<TestVariation> {
    return this.testVariations.updateIgnoreAreas(variationId, ignoreAreas);
  }

  @Put('comment/:id')
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateComment(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: CommentDto): Promise<TestVariation> {
    return this.testVariations.updateComment(id, body);
  }

  @Put('customTags/:id')
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateCustomTags(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: CustomTagsDto): Promise<TestVariation> {
    return this.testVariations.updateCustomTags(id, body);
  }

  @Get('merge/')
  @ApiQuery({ name: 'projectId', required: true })
  @ApiQuery({ name: 'branchName', required: true })
  @ApiOkResponse({ type: BuildDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  merge(
    @Query('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('branchName') branchName: string
  ): Promise<BuildDto> {
    return this.testVariations.merge(projectId, branchName);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  delete(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestVariation> {
    return this.testVariations.delete(id);
  }
}
