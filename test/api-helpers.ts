import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { existsSync } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { AppModule } from '../src/app.module';
import { HDD_IMAGE_PATH } from '../src/static/hdd/constants';

/** Boots the whole app the same way the other e2e specs do. */
export const createE2eApp = async (): Promise<{ app: INestApplication; moduleFixture: TestingModule }> => {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe());
  await app.init();
  return { app, moduleFixture };
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: [number, number, number];
}

/**
 * A tiny white PNG with solid rectangles painted on it. Synthetic images keep
 * the diffs fast and make the change (its colour and its area) exact.
 */
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

/** Where the HDD storage keeps a stored image (the default STATIC_SERVICE). */
export const storedImagePath = (imageName: string): string => path.resolve(HDD_IMAGE_PATH, imageName);

export const imageExists = (imageName: string): boolean => !!imageName && existsSync(storedImagePath(imageName));

/** Polls until the predicate holds — for image deletions the app fires and does not await. */
export const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error('waitFor: condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

/** Keys of TestRunDto — what the API exposes for a test run. */
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
