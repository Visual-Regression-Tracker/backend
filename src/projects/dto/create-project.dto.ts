import { PickType } from '@nestjs/swagger';
import { ProjectDto } from './project.dto';

export class CreateProjectDto extends PickType(ProjectDto, ['name', 'mainBranchName']) {}
