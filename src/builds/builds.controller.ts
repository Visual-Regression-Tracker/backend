import {
  Controller,
  Get,
  UseGuards,
  Post,
  Body,
  Param,
} from '@nestjs/common';
import { BuildsService } from './builds.service';
import { JwtAuthGuard } from 'src/auth/guards/auth.guard';
import { BuildDto } from './dto/builds.dto';
import { ApiOkResponse, ApiBearerAuth, ApiTags, ApiParam, ApiSecurity } from '@nestjs/swagger';
import { CreateBuildDto } from './dto/build-create.dto';
import { ApiGuard } from 'src/auth/guards/api.guard';

@Controller('builds')
@ApiTags('builds')
export class BuildsController {
  constructor(private buildsService: BuildsService) {}

  @Get(':projectId')
  @ApiParam({ name: 'projectId', required: true })
  @ApiOkResponse({ type: [BuildDto] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getAll(@Param('projectId') projectId: string): Promise<BuildDto[]> {
    return this.buildsService.findAll(projectId);
  }

  @Post()
  @ApiOkResponse({ type: BuildDto })
  @ApiSecurity('api_key')
  @UseGuards(ApiGuard)
  create(@Body() createBuildDto: CreateBuildDto): Promise<BuildDto> {
    return this.buildsService.create(createBuildDto);
  }
}
