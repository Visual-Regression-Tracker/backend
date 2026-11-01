import { INestApplication } from '@nestjs/common';
import { Project, TestStatus } from '@prisma/client';
import { readFileSync } from 'fs';
import { PNG } from 'pngjs';
import request from 'supertest';
import { BuildsService } from '../src/builds/builds.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';
import { StaticService } from '../src/static/static.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { CHANGED, createE2eApp, haveProject, pngBuffer, postRunDirect, storedImagePath } from './api-helpers';

describe('Images (e2e)', () => {
  let app: INestApplication;
  let projectsService: ProjectsService;
  let buildsService: BuildsService;
  let testRunsService: TestRunsService;
  let staticService: StaticService;
  let prisma: PrismaService;
  let project: Project;

  const get = (path: string) => request(app.getHttpServer()).get(path);

  const asBuffer = (res: request.Response, callback: (err: Error | null, body: Buffer) => void) => {
    const stream = res as unknown as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => callback(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    const created = await createE2eApp();
    app = created.app;
    projectsService = created.get(ProjectsService);
    buildsService = created.get(BuildsService);
    testRunsService = created.get(TestRunsService);
    staticService = created.get(StaticService);
    prisma = created.get(PrismaService);
  });

  beforeEach(async () => {
    project = await haveProject(projectsService, 'Images E2E', { autoApproveFeature: false });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await projectsService.remove(project.id);
  });

  afterAll(async () => {
    await app.close();
  });

  const postRun = async (image: Buffer) =>
    postRunDirect(
      testRunsService,
      await buildsService.findOrCreate({ projectId: project.id, branchName: 'master' }),
      image
    );

  describe('GET /images/:fileName', () => {
    it('redirects to the stored file, cacheable privately, without authentication', async () => {
      const run = await postRun(pngBuffer());

      const res = await get(`/images/${run.imageName}`).expect(302);

      expect(res.headers.location).toBe(`/${run.imageName}`);
      expect(res.headers['cache-control']).toBe('private, max-age=3000');
    });

    it('redirects a well-formed name without checking that it is stored', async () => {
      const res = await get('/images/missing.screenshot.png').expect(302);

      expect(res.headers.location).toBe('/missing.screenshot.png');
    });

    it.each(['%2Fexample.com', '%2F%2Fexample.com', 'nested%2Fimage.png', '..', '%5Cevil.com'])(
      'refuses %s as an image name instead of redirecting',
      async (name) => {
        const res = await get(`/images/${name}`).expect(400);

        expect(res.headers.location).toBeUndefined();
        expect(res.body.message).toBe('Invalid image name');
      }
    );

    it('500 when storage cannot produce a URL', async () => {
      jest.spyOn(staticService, 'getImageUrl').mockRejectedValueOnce(new Error('storage down'));

      const res = await get('/images/any.screenshot.png').expect(500);

      expect(res.text).toBe('Error occurred while getting the file.');
      expect(res.headers['cache-control']).toBeUndefined();
    });
  });

  describe('GET /images/:fileName/download', () => {
    it('serves the stored bytes as a PNG attachment', async () => {
      const run = await postRun(pngBuffer());

      const res = await get(`/images/${run.imageName}/download`).buffer(true).parse(asBuffer).expect(200);

      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${run.imageName}"`);
      expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      expect(Buffer.compare(res.body, readFileSync(storedImagePath(run.imageName)))).toBe(0);
    });

    it('serves the diff and thumbnails of an unresolved run', async () => {
      const first = await postRun(pngBuffer());
      await testRunsService.approve(first.id);
      const run = await postRun(CHANGED);
      expect(run.status).toBe(TestStatus.unresolved);
      const stored = (await prisma.testRun.findUnique({ where: { id: run.id } }))!;

      for (const name of [stored.diffName, stored.imageThumbnailName, stored.diffThumbnailName]) {
        const res = await get(`/images/${name}/download`).buffer(true).parse(asBuffer).expect(200);
        const png = PNG.sync.read(res.body);
        expect(png.width).toBeGreaterThan(0);
      }
    });

    it('404 for a name that is not stored', async () => {
      const res = await get('/images/missing.screenshot.png/download').expect(404);

      expect(res.body.message).toBe('Image not found: missing.screenshot.png');
    });

    it('400 for a name that merely starts with dots, it is not a generated name', async () => {
      await get('/images/..missing.png/download').expect(400);
    });

    it.each([
      ['%2E%2E', 'parent directory'],
      ['%2E', 'current directory'],
      ['..%2Fpackage.json', 'traversal'],
      ['..%2F..%2Fetc%2Fpasswd', 'deep traversal'],
      ['%2Fetc%2Fpasswd', 'absolute path'],
      ['sub%2Fimage.png', 'nested path'],
    ])('400 for %s (%s)', async (name) => {
      const res = await get(`/images/${name}/download`).expect(400);

      expect(res.body.message).toBe('Invalid image name');
    });
  });
});
