import {
  Controller,
  Get,
  UseGuards,
  Body,
  Post,
  Param,
  ParseUUIDPipe,
  Delete,
  Put,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiNoContentResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { Project, Role, User } from '@prisma/client';
import { ProjectDto } from './dto/project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../shared/roles.decorator';
import { CurrentUser } from '../shared/current-user.decorator';
import { MaskApiKeyInterceptor } from './api-key-mask';

@Controller('projects')
@ApiTags('projects')
@UseInterceptors(MaskApiKeyInterceptor)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: ProjectDto, isArray: true })
  getAll(): Promise<Project[]> {
    return this.projectsService.findAll();
  }

  // No RoleGuard: favourites are personal. Declared before any `:id` route so "favorites" is not read as an id
  @Get('favorites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: String, isArray: true, description: "Ids of the current user's favourite projects" })
  getFavorites(@CurrentUser() user: User): Promise<string[]> {
    return this.projectsService.findFavoriteIds(user.id);
  }

  @Put(':id/favorite')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The project is a favourite (also when it already was)' })
  @ApiNotFoundResponse({ description: 'Project not found' })
  @ApiParam({ name: 'id', required: true })
  addFavorite(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.projectsService.addFavorite(user.id, id);
  }

  @Delete(':id/favorite')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The project is not a favourite (also when it was not one, or does not exist)' })
  @ApiParam({ name: 'id', required: true })
  removeFavorite(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.projectsService.removeFavorite(user.id, id);
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
