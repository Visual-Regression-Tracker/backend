import { Injectable } from '@nestjs/common';
import { Build } from './build.entity';
import { InjectModel } from '@nestjs/sequelize';
import { BuildDto } from './dto/builds.dto';
import { CreateBuildDto } from './dto/build-create.dto';
import { Project } from 'src/projects/project.entity';
import { User } from 'src/users/user.entity';
import { Test } from 'src/tests/test.entity';

@Injectable()
export class BuildsService {
  constructor(
    @InjectModel(Build)
    private buildModel: typeof Build,
  ) {}

  async findById(id: number): Promise<BuildDto> {
    const build = await this.buildModel.findOne({
      where: { id },
      include: [Project, User, Test],
      order: [['createdAt', 'DESC']],
    });
    return new BuildDto(build);
  }

  async findAll(projectId: number): Promise<BuildDto[]> {
    const build = await this.buildModel.findAll({
      where: { projectId },
      include: [Project, User],
      order: [['createdAt', 'DESC']],
    });
    return build.map(b => new BuildDto(b));
  }

  async create(buildDto: CreateBuildDto): Promise<BuildDto> {
    const build = new Build();
    build.branchName = buildDto.branchName;
    build.projectId = buildDto.projectId;
    build.status = 'new';

    const buildData = await build.save();

    return this.findById(buildData.id);
  }
}
