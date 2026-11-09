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
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { BuildsService } from './builds.service';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ApiBearerAuth, ApiTags, ApiSecurity, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { CreateBuildDto } from './dto/build-create.dto';
import { ApiGuard } from '../auth/guards/api.guard';
import { Build, Role, User } from '@prisma/client';
import { BuildDto } from './dto/build.dto';
import { MixedGuard } from '../auth/guards/mixed.guard';
import { PaginatedBuildDto } from './dto/build-paginated.dto';
import { ModifyBuildDto } from './dto/build-modify.dto';
import { ProjectsService } from '../projects/projects.service';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../shared/roles.decorator';
import { CurrentUser } from '../shared/current-user.decorator';
import type { WrapperType } from '../shared/wrapper-type';

@Controller('builds')
@ApiTags('builds')
export class BuildsController {
  constructor(
    private buildsService: BuildsService,
    @Inject(forwardRef(() => ProjectsService))
    private projectService: WrapperType<ProjectsService>
  ) {}

  @Get()
  @ApiOkResponse({ type: PaginatedBuildDto })
  @ApiQuery({ name: 'ciBuildId', required: false, description: 'Case insensitive substring of the CI build id' })
  @ApiQuery({
    name: 'aroundBuildId',
    required: false,
    description: 'Return the page holding this build instead of the one at `skip`. Ignored when it holds no page.',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async get(
    @Query('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('take', new ParseIntPipe()) take: number,
    @Query('skip', new ParseIntPipe()) skip: number,
    @Query('ciBuildId') ciBuildId?: string,
    @Query('aroundBuildId', new ParseUUIDPipe({ optional: true })) aroundBuildId?: string
  ): Promise<PaginatedBuildDto> {
    if (skip < 0 || take < 0) {
      throw new BadRequestException('take and skip must not be negative');
    }
    return this.buildsService.findMany(projectId, take, skip, ciBuildId, aroundBuildId);
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
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<Build> {
    const build = await this.buildsService.remove(id);
    if (!build) {
      throw new NotFoundException(`Build not found: ${id}`);
    }
    return build;
  }

  @Post()
  @ApiOkResponse({ type: BuildDto })
  @ApiSecurity('api_key')
  @UseGuards(ApiGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async create(@Body() createBuildDto: CreateBuildDto): Promise<BuildDto> {
    const project = await this.projectService.findOne(createBuildDto.project);
    const build = await this.buildsService.findOrCreate({
      projectId: project.id,
      branchName: createBuildDto.branchName ?? project.mainBranchName,
      ciBuildId: createBuildDto.ciBuildId,
    });
    this.buildsService.scheduleRetention(project.id, project.maxBuildAllowed, build.id);
    return new BuildDto(build);
  }

  @Patch(':id')
  @ApiOkResponse({ type: BuildDto })
  @ApiSecurity('api_key')
  @ApiBearerAuth()
  @UseGuards(MixedGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() modifyBuildDto?: ModifyBuildDto): Promise<BuildDto> {
    // Released SDKs stop a build with an empty PATCH body; Express 5 leaves req.body undefined then.
    if (!modifyBuildDto || Object.keys(modifyBuildDto).length === 0) {
      modifyBuildDto = { isRunning: false };
    }
    return this.buildsService.update(id, modifyBuildDto);
  }

  @Patch(':id/approve')
  @ApiOkResponse({ type: BuildDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  approve(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('merge', new ParseBoolPipe()) merge: boolean
  ): Promise<void> {
    return this.buildsService.approve(id, merge, user.id);
  }
}
