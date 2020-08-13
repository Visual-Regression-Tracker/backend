import { Controller, Get, UseGuards, Post, Body, Param, ParseUUIDPipe, Delete, Query, Patch } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ApiBearerAuth, ApiTags, ApiSecurity, ApiResponse } from '@nestjs/swagger';
import { CreateBuildDto } from './dto/build-create.dto';
import { ApiGuard } from '../auth/guards/api.guard';
import { Build } from '@prisma/client';
import { BuildDto } from './dto/build.dto';
import { MixedGuard } from '../auth/guards/mixed.guard';

@Controller('builds')
@ApiTags('builds')
export class BuildsController {
  constructor(private buildsService: BuildsService) {}

  @Get()
  @ApiResponse({ type: [BuildDto] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  get(@Query('projectId', new ParseUUIDPipe()) projectId: string): Promise<BuildDto[]> {
    return this.buildsService.findMany(projectId);
  }

  @Delete(':id')
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

  @Patch(':id')
  @ApiResponse({ type: BuildDto })
  @ApiSecurity('api_key')
  @ApiBearerAuth()
  @UseGuards(MixedGuard)
  stop(@Param('id', new ParseUUIDPipe()) id: string): Promise<BuildDto> {
    return this.buildsService.stop(id);
  }
}
