import { ImageComparison, TestRun, TestVariation } from '.prisma/client';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Project, TestStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { PixelmatchService } from './libs/pixelmatch.service';
import { ImageComparator } from './libs/image-comparator.interface';
import { StaticService } from '../shared/static/static.service';
import { DiffResult } from 'src/test-runs/diffResult';
import { TestRunsService } from 'src/test-runs/test-runs.service';
import { IgnoreAreaDto } from 'src/test-runs/dto/ignore-area.dto';

@Injectable()
export class CompareService {
  constructor(
    private prismaService: PrismaService,
    private staticService: StaticService,
    private pixelmatchService: PixelmatchService,
    @Inject(forwardRef(() => TestRunsService))
    private testRunsService: TestRunsService
  ) {}

  async process({
    project,
    testRun,
    testVariation,
  }: {
    project: Project;
    testRun: TestRun;
    testVariation: TestVariation;
  }) {
    // remove previous result in case of retry
    this.staticService.deleteImage(testRun.diffName);

    // find diff
    const comparator = this.getComparator(project);
    const diffResult = comparator.getDiff({
      image: testRun.imageName,
      baseline: testRun.baselineName,
      ignoreAreas: this.getIgnoteAreas(testRun),
    });

    // save diff
    return this.testRunsService.saveDiffResult(testRun.id, diffResult);
  }

  getComparator(project: Project): ImageComparator {
    switch (project.imageComparison) {
      case ImageComparison.pixelmatch: {
        return this.pixelmatchService;
      }
      default: {
        return this.pixelmatchService;
      }
    }
  }

  private getIgnoteAreas(testRun: TestRun): IgnoreAreaDto[] {
    let ignoreAreas: IgnoreAreaDto[] = JSON.parse(testRun.ignoreAreas);
    if (testRun.ignoreAreas?.length > 0) {
      ignoreAreas = ignoreAreas.concat(JSON.parse(testRun.tempIgnoreAreas));
    }
    return ignoreAreas;
  }
}
