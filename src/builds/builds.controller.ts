import {
  Controller,
  Get,
  UseGuards,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Delete,
  Query,
  Patch,
  ParseIntPipe,
  ParseBoolPipe,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { BuildsService } from './builds.service';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ApiBearerAuth, ApiTags, ApiSecurity, ApiOkResponse } from '@nestjs/swagger';
import { CreateBuildDto } from './dto/build-create.dto';
import { ApiGuard } from '../auth/guards/api.guard';
import { Build, Role } from '@prisma/client';
import { BuildDto } from './dto/build.dto';
import { MixedGuard } from '../auth/guards/mixed.guard';
import { PaginatedBuildDto } from './dto/build-paginated.dto';
import { ModifyBuildDto } from './dto/build-modify.dto';
import { ProjectsService } from '../projects/projects.service';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../shared/roles.decorator';

@Controller('builds')
@ApiTags('builds')
export class BuildsController {
  constructor(
    private buildsService: BuildsService,
    @Inject(forwardRef(() => ProjectsService))
    private projectService: ProjectsService
  ) {}

  @Get()
  @ApiOkResponse({ type: PaginatedBuildDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  get(
    @Query('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('take', new ParseIntPipe()) take: number,
    @Query('skip', new ParseIntPipe()) skip: number
  ): Promise<PaginatedBuildDto> {
    return this.buildsService.findMany(projectId, take, skip);
  }

  @Get(':id')
  @ApiOkResponse({ type: BuildDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getDetails(@Param('id', new ParseUUIDPipe()) id: string): Promise<BuildDto> {
    return this.buildsService.findOne(id);
  }

  @Delete(':id')
  @ApiOkResponse({ type: BuildDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<Build> {
    return this.buildsService.remove(id);
  }

  @Post()
  @ApiOkResponse({ type: BuildDto })
  @ApiSecurity('api_key')
  @UseGuards(ApiGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async create(@Body() createBuildDto: CreateBuildDto): Promise<BuildDto> {
    const project = await this.projectService.findOne(createBuildDto.project);
    await this.buildsService.deleteOldBuilds(project.id, project.maxBuildAllowed);
    const build = await this.buildsService.findOrCreate({
      projectId: project.id,
      branchName: createBuildDto.branchName ?? project.mainBranchName,
      ciBuildId: createBuildDto.ciBuildId,
    });
    return new BuildDto(build);
  }

  @Patch(':id')
  @ApiOkResponse({ type: BuildDto })
  @ApiSecurity('api_key')
  @ApiBearerAuth()
  @UseGuards(MixedGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() modifyBuildDto?: ModifyBuildDto): Promise<BuildDto> {
    //In future, no or empty body will do nothing as this check will be removed. It will expect a proper body to perform any patch.
    if (modifyBuildDto === null || Object.keys(modifyBuildDto).length === 0) {
      modifyBuildDto.isRunning = false;
    }
    return this.buildsService.update(id, modifyBuildDto);
  }

  @Patch(':id/approve')
  @ApiOkResponse({ type: BuildDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('merge', new ParseBoolPipe()) merge: boolean
  ): Promise<void> {
    return this.buildsService.approve(id, merge);
  }
}
