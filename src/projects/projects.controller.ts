import { Controller, Get, UseGuards, Body, Post, Param, ParseUUIDPipe, Delete, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOkResponse, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { Project, Role } from '@prisma/client';
import { ProjectDto } from './dto/project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../shared/roles.decorator';

@Controller('projects')
@ApiTags('projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: ProjectDto, isArray: true })
  getAll(): Promise<Project[]> {
    return this.projectsService.findAll();
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  @ApiOkResponse({ type: ProjectDto })
  create(@Body() createProjectDto: CreateProjectDto): Promise<Project> {
    return this.projectsService.create(createProjectDto);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  @ApiOkResponse({ type: ProjectDto })
  update(@Body() projectDto: UpdateProjectDto): Promise<Project> {
    return this.projectsService.update(projectDto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  @ApiOkResponse({ type: ProjectDto })
  @ApiParam({ name: 'id', required: true })
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<Project> {
    return this.projectsService.remove(id);
  }
}
