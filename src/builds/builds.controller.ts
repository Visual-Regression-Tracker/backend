import { Controller, Get, UseGuards, Post, Body, Req } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { BuildDto } from './dto/builds.dto';
import { ApiOkResponse, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateBuildDto } from './dto/build-create.dto';

@Controller('builds')
@ApiTags('builds')
export class BuildsController {
  constructor(private buildsService: BuildsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOkResponse({ type: [BuildDto] })
  @ApiBearerAuth()
  getAll(): Promise<BuildDto[]> {
    return this.buildsService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOkResponse({ type: BuildDto })
  @ApiBearerAuth()
  create(
    @Body() createBuildDto: CreateBuildDto,
    @Req() request,
  ): Promise<BuildDto> {
    return this.buildsService.create(request.user.id, createBuildDto);
  }
}
