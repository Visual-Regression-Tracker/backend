import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { CreateProjectDto } from './dto/create-project.dto';
import { BuildDto } from '../builds/dto/build.dto';
import { EventsGateway } from '../shared/events/events.gateway';
import { StaticService } from '../static/static.service';
import { PrismaService } from '../prisma/prisma.service';
import { isPrismaError } from '../prisma/prisma-errors';
import { ImageComparison, Prisma, Project } from '@prisma/client';
import { isUuidShaped } from '../utils/random-key';
import { testRunImageNames } from '../utils';
import { UpdateProjectDto } from './dto/update-project.dto';
import { isHddStaticServiceConfigured } from '../static/utils';

const MAX_REMOVE_ATTEMPTS = 3;
const REMOVE_TRANSACTION = { maxWait: 10_000, timeout: 120_000 };

const projectData = (dto: CreateProjectDto | UpdateProjectDto) => ({
  name: dto.name,
  mainBranchName: dto.mainBranchName,
  autoApproveFeature: dto.autoApproveFeature,
  imageComparison: dto.imageComparison,
  imageComparisonConfig: dto.imageComparisonConfig,
  maxBuildAllowed: dto.maxBuildAllowed,
  maxBranchLifetime: dto.maxBranchLifetime,
  bulkApproveVariations: dto.bulkApproveVariations,
  bulkApproveGroupBy: dto.bulkApproveGroupBy,
});

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private prismaService: PrismaService,
    private staticService: StaticService,
    private eventsGateway: EventsGateway
  ) {}

  async findOne(idOrName: string): Promise<Project> {
    const isUUID = isUuidShaped(idOrName);
    const project = await this.prismaService.project.findUnique({
      where: {
        id: isUUID ? idOrName : undefined,
        name: !isUUID ? idOrName : undefined,
      },
    });

    if (!project) {
      throw new HttpException(`Project not found`, HttpStatus.NOT_FOUND);
    }
    return project;
  }

  async findAll(): Promise<Project[]> {
    return this.prismaService.project.findMany();
  }

  async findFavoriteIds(userId: string): Promise<string[]> {
    const projects = await this.prismaService.project.findMany({
      where: { favoritedBy: { some: { id: userId } } },
      select: { id: true },
    });
    return projects.map(({ id }) => id);
  }

  async addFavorite(userId: string, projectId: string): Promise<void> {
    await this.findOne(projectId);
    await this.prismaService.user.update({
      where: { id: userId },
      data: { favoriteProjects: { connect: { id: projectId } } },
      select: { id: true },
    });
  }

  async removeFavorite(userId: string, projectId: string): Promise<void> {
    await this.prismaService.user.update({
      where: { id: userId },
      data: { favoriteProjects: { disconnect: { id: projectId } } },
      select: { id: true },
    });
  }

  private assertComparisonSupported(imageComparison: ImageComparison): void {
    if (imageComparison === ImageComparison.odiff && !isHddStaticServiceConfigured()) {
      throw new BadRequestException('Odiff can only be used with the HDD static service (STATIC_SERVICE=hdd)');
    }
  }

  async create(projectDto: CreateProjectDto): Promise<Project> {
    this.assertComparisonSupported(projectDto.imageComparison);
    return this.prismaService.project.create({ data: projectData(projectDto) });
  }

  async update(projectDto: UpdateProjectDto): Promise<Project> {
    this.assertComparisonSupported(projectDto.imageComparison);
    return this.prismaService.project.update({ where: { id: projectDto.id }, data: projectData(projectDto) });
  }

  async remove(id: string): Promise<Project> {
    this.logger.debug(`Going to remove Project ${id}`);
    await this.findOne(id);
    for (let attempt = 1; ; attempt++) {
      try {
        const { project, builds, fileNames } = await this.prismaService.$transaction(
          (tx) => this.removeRows(tx, id),
          REMOVE_TRANSACTION
        );
        // Files only after the commit: a failure leaks bytes instead of leaving rows that point at deleted images
        await this.staticService.deleteImages(fileNames);
        builds.forEach((build) => this.eventsGateway.buildDeleted(new BuildDto(build)));
        return project;
      } catch (e) {
        if (isPrismaError(e, 'P2025')) {
          throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
        }
        if (!isPrismaError(e, 'P2003')) {
          throw e;
        }
        if (attempt === MAX_REMOVE_ATTEMPTS) {
          throw new ConflictException(`Project ${id} keeps receiving uploads, try again later`);
        }
      }
    }
  }

  private async removeRows(tx: Prisma.TransactionClient, projectId: string) {
    const ofProjectBuilds = { build: { projectId } };
    const ofProjectVariations = { testVariation: { projectId } };
    const builds = await tx.build.findMany({ where: { projectId } });
    const testRuns = await tx.testRun.findMany({
      where: ofProjectBuilds,
      select: { imageName: true, diffName: true, imageThumbnailName: true, diffThumbnailName: true },
    });
    const baselines = await tx.baseline.findMany({ where: ofProjectVariations, select: { baselineName: true } });
    await tx.testRun.deleteMany({ where: ofProjectBuilds });
    await tx.baseline.deleteMany({ where: ofProjectVariations });
    await tx.testVariation.deleteMany({ where: { projectId } });
    await tx.build.deleteMany({ where: { projectId } });
    const project = await tx.project.delete({ where: { id: projectId } });
    const fileNames = [...testRuns.flatMap(testRunImageNames), ...baselines.map((b) => b.baselineName)];
    return { project, builds, fileNames };
  }
}
