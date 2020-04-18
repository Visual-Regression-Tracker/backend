import { Injectable } from '@nestjs/common';
import { Build } from './build.entity';
import { InjectModel } from '@nestjs/sequelize';
import { BuildDto } from './dto/builds.dto';
import { CreateBuildDto } from './dto/build-create.dto';

@Injectable()
export class BuildsService {
  constructor(
    @InjectModel(Build)
    private buildModel: typeof Build,
  ) {}

  async findAll(): Promise<BuildDto[]> {
    const build = await this.buildModel.findAll();
    return build.map(b => new BuildDto(b));
  }

  async create(userId: number, buildDto: CreateBuildDto): Promise<BuildDto> {
    const build = new Build();
    build.branchName = buildDto.branchName;
    build.status = 'new';
    build.userId = userId;

    const buildData = await build.save();

    return new BuildDto(buildData);
  }
}
