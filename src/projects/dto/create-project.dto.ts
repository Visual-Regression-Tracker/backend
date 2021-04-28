import { OmitType } from '@nestjs/swagger';
import { UpdateProjectDto } from './update-project.dto';

export class CreateProjectDto extends OmitType(UpdateProjectDto, ['id']) {}
