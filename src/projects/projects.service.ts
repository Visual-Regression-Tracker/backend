import { forwardRef, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { CreateProjectDto } from './dto/create-project.dto';
import { BuildsService } from '../builds/builds.service';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { PrismaService } from '../prisma/prisma.service';
import { Project } from '@prisma/client';
import { isUuidShaped } from '../utils/random-key';
import { UpdateProjectDto } from './dto/update-project.dto';
import type { WrapperType } from '../shared/wrapper-type';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly ongoingDeletions = new Map<string, Promise<void>>();

  constructor(
    private prismaService: PrismaService,
    @Inject(forwardRef(() => BuildsService))
    private buildsService: WrapperType<BuildsService>,
    @Inject(forwardRef(() => TestVariationsService))
    private testVariationsService: WrapperType<TestVariationsService>
  ) {}

  async findOne(idOrName: string): Promise<Project | null> {
    const isUUID = isUuidShaped(idOrName);
    const project: Project | null = await this.prismaService.project.findUnique({
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
    // connect alone would fail with a Prisma error for an unknown project;
    // findOne turns that into the API's usual 404
    await this.findOne(projectId);
    // connecting an already connected project is a no-op, so adding twice is fine
    await this.prismaService.user.update({
      where: { id: userId },
      data: { favoriteProjects: { connect: { id: projectId } } },
      select: { id: true },
    });
  }

  async removeFavorite(userId: string, projectId: string): Promise<void> {
    // disconnecting a project that is not connected (or does not exist) is a
    // no-op, which makes removal idempotent without a lookup
    await this.prismaService.user.update({
      where: { id: userId },
      data: { favoriteProjects: { disconnect: { id: projectId } } },
      select: { id: true },
    });
  }

  async create(projectDto: CreateProjectDto): Promise<Project> {
    return this.prismaService.project.create({
      data: {
        name: projectDto.name,
        mainBranchName: projectDto.mainBranchName,
        autoApproveFeature: projectDto.autoApproveFeature,
        imageComparison: projectDto.imageComparison,
        imageComparisonConfig: projectDto.imageComparisonConfig,
        maxBuildAllowed: projectDto.maxBuildAllowed,
        maxBranchLifetime: projectDto.maxBranchLifetime,
        bulkApproveVariations: projectDto.bulkApproveVariations,
        bulkApproveGroupBy: projectDto.bulkApproveGroupBy,
      },
    });
  }

  async update(projectDto: UpdateProjectDto): Promise<Project> {
    return this.prismaService.project.update({
      where: { id: projectDto.id },
      data: {
        name: projectDto.name,
        mainBranchName: projectDto.mainBranchName,
        autoApproveFeature: projectDto.autoApproveFeature,
        imageComparison: projectDto.imageComparison,
        maxBuildAllowed: projectDto.maxBuildAllowed,
        maxBranchLifetime: projectDto.maxBranchLifetime,
        imageComparisonConfig: projectDto.imageComparisonConfig,
        bulkApproveVariations: projectDto.bulkApproveVariations,
        bulkApproveGroupBy: projectDto.bulkApproveGroupBy,
      },
    });
  }

  async remove(id: string): Promise<Project> {
    if (this.ongoingDeletions.has(id)) {
      this.logger.debug(`Deletion for project ${id} is already in progress.`);
      return (await this.prismaService.project.findUnique({
        where: { id },
      }))!;
    }

    this.logger.debug(`Going to remove Project ${id}`);
    const project = await this.prismaService.project.findUnique({
      where: { id },
      include: {
        builds: true,
        testVariations: true,
      },
    });
    const builds = project!.builds;
    const testVariations = project!.testVariations;

    const deletionPromise = (async () => {
      for (const build of builds) {
        await this.buildsService.remove(build.id);
      }
      for (const testVariation of testVariations) {
        await this.testVariationsService.delete(testVariation.id);
      }
      await this.prismaService.project.delete({
        where: { id },
      });
    })();

    this.ongoingDeletions.set(id, deletionPromise);

    deletionPromise
      .finally(() => {
        this.ongoingDeletions.delete(id);
        this.logger.debug(`Deletion promise for project ${id} resolved/rejected and removed from map.`);
      })
      // finally() hands on the rejection in a promise nobody awaits: unhandled,
      // it would take the whole process down. Log it instead.
      .catch((err: unknown): void => {
        this.logger.error(`Failed to remove project ${id}`, err instanceof Error ? err.stack : err);
      });

    return project!;
  }
}
