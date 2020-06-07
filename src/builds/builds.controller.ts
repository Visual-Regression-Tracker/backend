import { Controller, Get, UseGuards, Post, Body, Param, ParseUUIDPipe, Delete, Query } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ApiBearerAuth, ApiTags, ApiParam, ApiSecurity, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { CreateBuildDto } from './dto/build-create.dto';
import { ApiGuard } from '../auth/guards/api.guard';
import { Build } from '@prisma/client';
import { BuildDto } from './dto/build.dto';

@Controller('builds')
@ApiTags('builds')
export class BuildsController {
  constructor(private buildsService: BuildsService) {}

  @Get()
  @ApiQuery({ name: 'projectId', required: true })
  @ApiResponse({ type: [BuildDto] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  get(@Query('projectId', new ParseUUIDPipe()) projectId: string): Promise<BuildDto[]> {
    return this.buildsService.findMany(projectId);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<Build> {
    return this.buildsService.remove(id);
  }

  @Post()
  @ApiResponse({ type: BuildDto })
  @ApiSecurity('api_key')
  @UseGuards(ApiGuard)
  create(@Body() createBuildDto: CreateBuildDto): Promise<BuildDto> {
    return this.buildsService.create(createBuildDto);
  }
}
