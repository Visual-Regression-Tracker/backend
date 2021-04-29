import { OmitType } from '@nestjs/swagger';
import { ProjectDto } from './project.dto';

export class UpdateProjectDto extends OmitType(ProjectDto, ['buildsCounter', 'createdAt', 'updatedAt']) {}
