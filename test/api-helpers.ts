import { INestApplication, Type } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { Build } from '@prisma/client';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { TEST_PROJECT } from '../src/_data_';
import { AppModule } from '../src/app.module';
import { ProjectsService } from '../src/projects/projects.service';
import { GlobalValidationPipe } from '../src/shared/validation';
import { HDD_IMAGE_PATH } from '../src/static/hdd/constants';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { LoggedUser, requestWithApiKey, requestWithAuth } from './preconditions';

interface E2eAppOptions {
  overrides?: Array<[Type<unknown>, unknown]>;
  validation?: boolean;
  configure?: (app: NestExpressApplication) => void;
}

export const createE2eApp = async ({ overrides = [], validation = true, configure }: E2eAppOptions = {}) => {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const [token, value] of overrides) {
    builder = builder.overrideProvider(token).useValue(value);
  }
  const moduleFixture: TestingModule = await builder.compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  if (validation) {
    app.useGlobalPipes(new GlobalValidationPipe());
  }
  configure?.(app);
  await app.init();
  return { app, moduleFixture, get: <T>(token: Type<T>): T => moduleFixture.get(token) };
};

export const haveProject = (
  projectsService: ProjectsService,
  label: string,
  overrides: Partial<Parameters<ProjectsService['create']>[0]> = {}
) => projectsService.create({ ...TEST_PROJECT, ...overrides, name: `${label} ${randomUUID()}` });

export const postRunDirect = (testRunsService: TestRunsService, build: Build, image: Buffer, name = 'Screen') =>
  testRunsService.postTestRun({
    createTestRequestDto: { projectId: build.projectId, buildId: build.id, branchName: build.branchName!, name },
    imageBuffer: image,
  });

export const postRunBase64 = async (
  app: INestApplication,
  user: LoggedUser,
  build: Build,
  image: Buffer,
  extra: Record<string, unknown> = {}
): Promise<Record<string, any>> =>
  (
    await requestWithApiKey(app, 'post', '/test-runs', user.apiKey)
      .send({
        projectId: build.projectId,
        buildId: build.id,
        branchName: build.branchName,
        name: 'Screen',
        imageBase64: image.toString('base64'),
        ...extra,
      })
      .expect(201)
  ).body;

export const setEnv = (vars: Record<string, string>): (() => void) => {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
};

export const withEnv = async <T>(vars: Record<string, string>, fn: () => PromiseLike<T>): Promise<T> => {
  const restore = setEnv(vars);
  try {
    return await fn();
  } finally {
    restore();
  }
};

export const approveRuns = (app: INestApplication, user: LoggedUser, ids: string[], merge = false) =>
  requestWithAuth(app, 'post', `/test-runs/approve?merge=${merge}`, user.token).send(ids).expect(201);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: [number, number, number];
}

export const pngBuffer = (rects: Rect[] = [], width = 60, height = 60): Buffer => {
  const png = new PNG({ width, height });
  png.data.fill(255);
  for (const { x, y, w, h, color } of rects) {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        const idx = (width * row + col) << 2;
        png.data[idx] = color[0];
        png.data[idx + 1] = color[1];
        png.data[idx + 2] = color[2];
        png.data[idx + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
};

export const RED: [number, number, number] = [255, 0, 0];
export const BLUE: [number, number, number] = [0, 0, 255];

export const WHITE = pngBuffer();
export const redAt = (x: number, y: number, size = 10): Rect => ({ x, y, w: size, h: size, color: RED });
export const CHANGED = pngBuffer([redAt(5, 5)]);

export const storedImagePath = (imageName: string): string => path.resolve(HDD_IMAGE_PATH, imageName);

export const imageExists = (imageName: string | null): boolean => !!imageName && existsSync(storedImagePath(imageName));

export const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error('waitFor: condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

export const TEST_RUN_DTO_KEYS = [
  'baselineBranchName',
  'baselineName',
  'branchName',
  'browser',
  'buildId',
  'comment',
  'customTags',
  'device',
  'diffName',
  'diffPercent',
  'diffThumbnailName',
  'diffTollerancePercent',
  'id',
  'ignoreAreas',
  'imageName',
  'imageThumbnailName',
  'merge',
  'name',
  'os',
  'status',
  'tempIgnoreAreas',
  'testVariationId',
  'viewport',
  'vlmDescription',
];
