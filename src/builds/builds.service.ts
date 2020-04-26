import { Injectable } from '@nestjs/common';
import { Build } from './build.entity';
import { InjectModel } from '@nestjs/sequelize';
import { BuildDto } from './dto/builds.dto';
import { CreateBuildDto } from './dto/build-create.dto';
import { TestService } from 'src/test/test.service';
import { TestRunDto } from 'src/test/dto/test-run.dto';

@Injectable()
export class BuildsService {
  constructor(
    @InjectModel(Build)
    private buildModel: typeof Build,
    private testService: TestService,
  ) {}

  async findById(id: string): Promise<TestRunDto[]> {
    return this.testService.getTestRunsByBuildId(id);
  }

  async create(buildDto: CreateBuildDto): Promise<BuildDto> {
    const build = new Build();
    build.branchName = buildDto.branchName;
    build.projectId = buildDto.projectId;
    build.status = 'new';

    const buildData = await build.save();

    return new BuildDto(buildData);
  }

  async remove(id: string): Promise<number> {
    return this.buildModel.destroy({
      where: { id },
    });
  }
}
