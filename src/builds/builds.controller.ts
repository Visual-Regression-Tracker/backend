import { Controller, Get, UseGuards, Post, Body, Req, Param, ParseIntPipe } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { BuildDto } from './dto/builds.dto';
import {
  ApiOkResponse,
  ApiBearerAuth,
  ApiTags,
  ApiParam,
} from '@nestjs/swagger';
import { CreateBuildDto } from './dto/build-create.dto';

@Controller('builds')
@ApiTags('builds')
export class BuildsController {
  constructor(private buildsService: BuildsService) {}

  @Get(':projectId')
  @ApiParam({ name: 'projectId', required: true })
  @ApiOkResponse({ type: [BuildDto] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getAll(@Param('projectId', new ParseIntPipe()) projectId: number): Promise<BuildDto[]> {
    return this.buildsService.findAll(projectId);
  }

  @Post()
  @ApiOkResponse({ type: BuildDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  create(
    @Body() createBuildDto: CreateBuildDto,
    @Req() request,
  ): Promise<BuildDto> {
    return this.buildsService.create(request.user.id, createBuildDto);
  }
}
