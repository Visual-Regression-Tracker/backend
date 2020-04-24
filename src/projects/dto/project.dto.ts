import { ApiProperty } from '@nestjs/swagger';
import { Project } from '../project.entity';
import { Build } from 'src/builds/build.entity';

export class ProjectDto {
  @ApiProperty()
  readonly name: string;

  @ApiProperty()
  readonly builds: Build[];

  constructor(project: Project) {
    this.name = project.name;
    this.builds = project.builds;
  }
}
