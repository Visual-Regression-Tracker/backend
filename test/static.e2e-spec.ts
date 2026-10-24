import { INestApplication } from '@nestjs/common';
import { Project, TestStatus } from '@prisma/client';
import { readFileSync } from 'fs';
import { PNG } from 'pngjs';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { TEST_PROJECT } from '../src/_data_';
import { BuildsService } from '../src/builds/builds.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';
import { StaticService } from '../src/static/static.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { createE2eApp, pngBuffer, RED, storedImagePath } from './api-helpers';

describe('Images (e2e)', () => {
  let app: INestApplication;
  let projectsService: ProjectsService;
  let buildsService: BuildsService;
  let testRunsService: TestRunsService;
  let staticService: StaticService;
  let prisma: PrismaService;
  let project: Project;

  // supertest does not follow redirects, so the redirect itself is what is asserted
  const get = (path: string) => request(app.getHttpServer()).get(path);

  /** Binary response bodies as a Buffer. */
  const asBuffer = (res: request.Response, callback: (err: Error | null, body: Buffer) => void) => {
    // in Node the parser is handed the raw response stream, which superagent's types do not model
    const stream = res as unknown as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => callback(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    const created = await createE2eApp();
    app = created.app;
    projectsService = created.moduleFixture.get(ProjectsService);
    buildsService = created.moduleFixture.get(BuildsService);
    testRunsService = created.moduleFixture.get(TestRunsService);
    staticService = created.moduleFixture.get(StaticService);
    prisma = created.moduleFixture.get(PrismaService);
  });

  beforeEach(async () => {
    project = await projectsService.create({
      ...TEST_PROJECT,
      autoApproveFeature: false,
      name: `Images E2E ${randomUUID()}`,
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await projectsService.remove(project.id);
  });

  afterAll(async () => {
    await app.close();
  });

  const postRun = async (image: Buffer) => {
    const build = await buildsService.findOrCreate({ projectId: project.id, branchName: 'master' });
    return testRunsService.postTestRun({
      createTestRequestDto: { projectId: project.id, buildId: build.id, branchName: 'master', name: 'Screen' },
      imageBuffer: image,
    });
  };

  describe('GET /images/:fileName', () => {
    it('redirects to the stored file, cacheable privately, without authentication', async () => {
      const run = await postRun(pngBuffer());

      const res = await get(`/images/${run.imageName}`).expect(302);

      expect(res.headers.location).toBe(`/${run.imageName}`);
      expect(res.headers['cache-control']).toBe('private, max-age=3000');
    });

    it('a name that is not stored is still redirected', async () => {
      // NOTE: current behavior — the HDD backend does not check the file, the static handler 404s after the redirect
      const res = await get('/images/missing.screenshot.png').expect(302);

      expect(res.headers.location).toBe('/missing.screenshot.png');
    });

    // a leading slash used to come back as a protocol-relative Location
    // ('//example.com'): an open redirect to another host
    it.each(['%2Fexample.com', '%2F%2Fexample.com', 'nested%2Fimage.png', '..'])(
      'refuses %s as an image name instead of redirecting',
      async (name) => {
        const res = await get(`/images/${name}`).expect(400);

        expect(res.headers.location).toBeUndefined();
        expect(res.body.message).toBe('Invalid image name');
      }
    );

    it('500 when storage cannot produce a URL', async () => {
      jest.spyOn(staticService, 'getImageUrl').mockRejectedValueOnce(new Error('storage down'));

      const res = await get('/images/any.png').expect(500);

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
      expect(Buffer.compare(res.body, readFileSync(storedImagePath(run.imageName)))).toBe(0);
    });

    it('serves the diff and thumbnails of an unresolved run', async () => {
      const first = await postRun(pngBuffer());
      await testRunsService.approve(first.id);
      const run = await postRun(pngBuffer([{ x: 5, y: 5, w: 10, h: 10, color: RED }]));
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

    it('a name that merely starts with dots stays inside the image directory', async () => {
      await get('/images/..missing.png/download').expect(404);
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
