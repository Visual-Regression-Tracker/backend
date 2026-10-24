import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ImageComparison, Project, TestStatus } from '@prisma/client';
import { existsSync, readFileSync, promises as fs } from 'fs';
import { createServer } from 'net';
import { PNG } from 'pngjs';
import uuidAPIKey from 'uuid-apikey';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { ProjectsService } from '../src/projects/projects.service';
import { BuildsService } from '../src/builds/builds.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { HddService } from '../src/static/hdd/hdd.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { OllamaService } from '../src/compare/libs/vlm/providers/ollama/ollama.service';
import { IgnoreAreaDto } from '../src/test-runs/dto/ignore-area.dto';
import { DEFAULT_CONFIG as LOOKS_SAME_DEFAULT_CONFIG } from '../src/compare/libs/looks-same/looks-same.service';
import { DEFAULT_CONFIG as ODIFF_DEFAULT_CONFIG } from '../src/compare/libs/odiff/odiff.service';
import { DEFAULT_CONFIG as VLM_DEFAULT_CONFIG } from '../src/compare/libs/vlm/vlm.service';
import { Response } from 'supertest';
import { haveUserLogged, requestWithApiKey, requestWithAuth, LoggedUser } from './preconditions';

/**
 * Every comparator end to end: a real project with the comparator selected,
 * test runs posted over HTTP (multipart, like the SDKs), the real looks-same
 * library, the native odiff-bin binary and the HDD storage underneath.
 *
 * VLM: no Ollama or Gemini is reachable from the test machine. The real
 * OllamaService is used for the "provider unreachable" case (it is pointed at
 * a closed local port), the real GeminiService for the "no API key" case, and
 * the model's verdict is stubbed with jest.spyOn on the OllamaService instance
 * the app resolved, so everything around the provider call stays real.
 */

const SIZE = 360;
const TOTAL_PIXELS = SIZE * SIZE;
const SLOW_TEST = 90000;

const image = readFileSync('./test/image.png');
const imageEdited = readFileSync('./test/image_edited.png');
const imageEdited2 = readFileSync('./test/image_edited_2.png');

// The same picture with its last 60 columns cut off (300x360): a layout change
const cropWidth = (buffer: Buffer, width: number): Buffer => {
  const source = PNG.sync.read(buffer);
  const target = new PNG({ width, height: source.height });
  PNG.bitblt(source, target, 0, 0, width, source.height, 0, 0);
  return PNG.sync.write(target);
};
const imageNarrow = cropWidth(image, 300);

const WHOLE_IMAGE: IgnoreAreaDto[] = [{ x: 0, y: 0, width: SIZE, height: SIZE }];

const closedPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

describe('Comparators (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let projectsService: ProjectsService;
  let buildsService: BuildsService;
  let testRunsService: TestRunsService;
  let hddService: HddService;
  let prismaService: PrismaService;
  let ollamaService: OllamaService;
  let user: LoggedUser;
  const projectIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    usersService = moduleFixture.get(UsersService);
    projectsService = moduleFixture.get(ProjectsService);
    buildsService = moduleFixture.get(BuildsService);
    testRunsService = moduleFixture.get(TestRunsService);
    hddService = moduleFixture.get(HddService);
    prismaService = moduleFixture.get(PrismaService);
    ollamaService = moduleFixture.get(OllamaService);

    await app.init();
    user = await haveUserLogged(usersService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const id of projectIds.splice(0)) {
      await projectsService.remove(id);
    }
  });

  afterAll(async () => {
    await usersService.delete(user.id);
    await app.close();
  });

  const projectBody = (imageComparison: ImageComparison, imageComparisonConfig: string) => ({
    name: `Comparators E2E ${imageComparison} ${uuidAPIKey.create().uuid}`,
    mainBranchName: 'master',
    autoApproveFeature: false,
    imageComparison,
    imageComparisonConfig,
    maxBuildAllowed: 100,
    maxBranchLifetime: 30,
    bulkApproveVariations: false,
    bulkApproveGroupBy: 'customTags',
  });

  // created through the projects API, the way the UI does it
  const DEFAULT_CONFIGS: Partial<Record<ImageComparison, object>> = {
    [ImageComparison.lookSame]: LOOKS_SAME_DEFAULT_CONFIG,
    [ImageComparison.odiff]: ODIFF_DEFAULT_CONFIG,
  };

  const haveProject = async (
    imageComparison: ImageComparison,
    imageComparisonConfig = JSON.stringify(DEFAULT_CONFIGS[imageComparison] ?? {})
  ): Promise<Project> => {
    const res = await requestWithAuth(app, 'post', '/projects', user.token)
      .send(projectBody(imageComparison, imageComparisonConfig))
      .expect(201);
    projectIds.push(res.body.id);
    expect(res.body).toMatchObject({ imageComparison, imageComparisonConfig });
    return res.body;
  };

  // resolves with the response: an async helper cannot hand back the chainable supertest request
  const postTestRun = async (
    project: Project,
    imageBuffer: Buffer,
    extra: { diffTollerancePercent?: number; ignoreAreas?: IgnoreAreaDto[]; branchName?: string } = {},
    expectedStatus = 201
  ): Promise<Response> => {
    const branchName = extra.branchName ?? project.mainBranchName;
    const build = await buildsService.findOrCreate({ projectId: project.id, branchName });
    const req = requestWithApiKey(app, 'post', '/test-runs/multipart', user.apiKey)
      .field('projectId', project.id)
      .field('buildId', build.id)
      .field('branchName', branchName)
      .field('name', 'Comparator screen');
    if (extra.diffTollerancePercent !== undefined) {
      req.field('diffTollerancePercent', String(extra.diffTollerancePercent));
    }
    if (extra.ignoreAreas) {
      req.field('ignoreAreas', JSON.stringify(extra.ignoreAreas));
    }
    const res = await req.attach('image', imageBuffer, 'image.png');
    expect({ status: res.status, message: res.body.message }).toEqual({
      status: expectedStatus,
      message: expectedStatus === 201 ? undefined : expect.anything(),
    });
    return res;
  };

  const diffExists = (imageName: string) => existsSync(hddService.getImagePath(imageName));

  // posts the first image and approves it, so the next run of the same screen has a baseline
  // and resolves with the name of the baseline image file
  const haveBaseline = async (project: Project, imageBuffer: Buffer = image): Promise<string> => {
    const res = await postTestRun(project, imageBuffer);
    expect(res.body.status).toBe(TestStatus.new);
    const approved = await testRunsService.approve(res.body.id);
    // approving gave the run a variation and the variation a baseline
    const baselineName = (await prismaService.testVariation.findUnique({ where: { id: approved.testVariationId! } }))!
      .baselineName!;
    expect(diffExists(baselineName)).toBe(true);
    return baselineName;
  };

  describe('lookSame', () => {
    it(
      'new without a baseline, ok for the same image',
      async () => {
        const project = await haveProject(ImageComparison.lookSame);
        await haveBaseline(project);

        const res = await postTestRun(project, image);

        expect(res.body).toMatchObject({
          status: TestStatus.ok,
          diffPercent: 0,
          pixelMisMatchCount: 0,
          diffName: null,
        });
      },
      SLOW_TEST
    );

    it(
      'unresolved with a diff file for a changed image',
      async () => {
        const project = await haveProject(ImageComparison.lookSame);
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited);

        expect(res.body).toMatchObject({
          status: TestStatus.unresolved,
          pixelMisMatchCount: 31068,
          diffPercent: (31068 * 100) / TOTAL_PIXELS,
          // thumbnails and change signatures are pixelmatch-only
          imageThumbnailName: null,
          diffThumbnailName: null,
        });
        expect(res.body.diffName).toMatch(/\.diff\.png$/);
        expect(diffExists(res.body.diffName)).toBe(true);
        // looks-same writes a full-size diff image
        const diff = PNG.sync.read(await fs.readFile(hddService.getImagePath(res.body.diffName)));
        expect([diff.width, diff.height]).toEqual([SIZE, SIZE]);
      },
      SLOW_TEST
    );

    it(
      'ignores diffTollerancePercent',
      async () => {
        const project = await haveProject(ImageComparison.lookSame);
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited, { diffTollerancePercent: 100 });

        // NOTE: current behavior — looks-same never reads diffTollerancePercent, so a
        // tolerance that would make pixelmatch/odiff report ok still leaves the run unresolved
        expect(res.body.diffTollerancePercent).toBe(100);
        expect(res.body.status).toBe(TestStatus.unresolved);
      },
      SLOW_TEST
    );

    it(
      'ok when an ignore area covers the whole change',
      async () => {
        const project = await haveProject(ImageComparison.lookSame);
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited, { ignoreAreas: WHOLE_IMAGE });

        expect(res.body).toMatchObject({
          status: TestStatus.ok,
          diffPercent: 0,
          pixelMisMatchCount: 0,
          diffName: null,
        });
      },
      SLOW_TEST
    );

    it(
      'unresolved without numbers for a different size',
      async () => {
        const project = await haveProject(ImageComparison.lookSame);
        await haveBaseline(project);

        const res = await postTestRun(project, imageNarrow);

        expect(res.body).toMatchObject({
          status: TestStatus.unresolved,
          diffName: null,
          diffPercent: null,
          pixelMisMatchCount: null,
        });
      },
      SLOW_TEST
    );

    it(
      'compares a different size when the project config allows it',
      async () => {
        const project = await haveProject(ImageComparison.lookSame, JSON.stringify({ allowDiffDimensions: true }));
        await haveBaseline(project);

        const res = await postTestRun(project, imageNarrow);

        // the 60 missing columns are the difference, counted against the baseline's area
        expect(res.body).toMatchObject({
          status: TestStatus.unresolved,
          pixelMisMatchCount: 60 * SIZE,
          diffPercent: (60 * SIZE * 100) / TOTAL_PIXELS,
        });
        expect(diffExists(res.body.diffName)).toBe(true);
      },
      SLOW_TEST
    );

    it(
      'reads tolerance from the project config',
      async () => {
        // a partial config replaces the defaults instead of being merged into them
        const project = await haveProject(ImageComparison.lookSame, JSON.stringify({ tolerance: 100 }));
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited);

        // a ΔE tolerance of 100 accepts every colour change in this picture
        expect(res.body).toMatchObject({
          status: TestStatus.ok,
          diffPercent: 0,
          pixelMisMatchCount: 0,
          diffName: null,
        });
      },
      SLOW_TEST
    );

    it('the projects API rejects a config that is not JSON', async () => {
      await requestWithAuth(app, 'post', '/projects', user.token)
        .send(projectBody(ImageComparison.lookSame, 'not json'))
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toBe('imageComparisonConfig must be a json string');
          expect(res.body.exception.response.message).toEqual(['imageComparisonConfig must be a json string']);
        });
    });

    it(
      'falls back to the default config when the stored config is not JSON',
      async () => {
        const created = await haveProject(ImageComparison.lookSame);
        // only reachable by writing the column directly: the API validates the JSON
        const project = await prismaService.project.update({
          where: { id: created.id },
          data: { imageComparisonConfig: 'not json' },
        });
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited);

        // same numbers as with DEFAULT_CONFIG
        expect(res.body).toMatchObject({ status: TestStatus.unresolved, pixelMisMatchCount: 31068 });
        expect(diffExists(res.body.diffName)).toBe(true);
      },
      SLOW_TEST
    );

    it(
      'unresolved without numbers when looks-same rejects the config',
      async () => {
        // looks-same refuses strict together with tolerance
        const project = await haveProject(ImageComparison.lookSame, JSON.stringify({ strict: true, tolerance: 5 }));
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited);

        // NOTE: current behavior — a project config looks-same cannot use is only logged: every
        // changed screenshot becomes unresolved with no numbers and no diff to look at
        expect(res.body).toMatchObject({
          status: TestStatus.unresolved,
          diffName: null,
          diffPercent: null,
          pixelMisMatchCount: null,
        });
      },
      SLOW_TEST
    );

    it(
      'treats a missing baseline file as no baseline',
      async () => {
        const project = await haveProject(ImageComparison.lookSame);
        const baselineName = await haveBaseline(project);
        await fs.unlink(hddService.getImagePath(baselineName));

        const res = await postTestRun(project, imageEdited);

        expect(res.body).toMatchObject({ status: TestStatus.new, diffName: null, diffPercent: null });
      },
      SLOW_TEST
    );
  });

  describe('odiff', () => {
    it(
      'ok for the same image',
      async () => {
        const project = await haveProject(ImageComparison.odiff);
        await haveBaseline(project);

        const res = await postTestRun(project, image);

        expect(res.body).toMatchObject({
          status: TestStatus.ok,
          diffPercent: 0,
          pixelMisMatchCount: 0,
          diffName: null,
        });
      },
      SLOW_TEST
    );

    it(
      'unresolved with a diff file for a changed image',
      async () => {
        const project = await haveProject(ImageComparison.odiff);
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited);

        // odiff rounds the percentage to two decimals
        expect(res.body).toMatchObject({
          status: TestStatus.unresolved,
          pixelMisMatchCount: 31145,
          diffPercent: 24.03,
          imageThumbnailName: null,
          diffThumbnailName: null,
        });
        expect(res.body.diffName).toMatch(/\.diff\.png$/);
        expect(diffExists(res.body.diffName)).toBe(true);
      },
      SLOW_TEST
    );

    it(
      'ok within diffTollerancePercent, without keeping a diff',
      async () => {
        const project = await haveProject(ImageComparison.odiff);
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited, { diffTollerancePercent: 100 });

        // the numbers are kept, the diff image odiff wrote is deleted
        expect(res.body).toMatchObject({
          status: TestStatus.ok,
          diffName: null,
          pixelMisMatchCount: 31145,
          diffPercent: 24.03,
        });
      },
      SLOW_TEST
    );

    it(
      'ok when an ignore region covers the whole change',
      async () => {
        const project = await haveProject(ImageComparison.odiff);
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited, { ignoreAreas: WHOLE_IMAGE });

        expect(res.body).toMatchObject({
          status: TestStatus.ok,
          diffPercent: 0,
          pixelMisMatchCount: 0,
          diffName: null,
        });
      },
      SLOW_TEST
    );

    it(
      'unresolved without numbers for a different size',
      async () => {
        const project = await haveProject(ImageComparison.odiff);
        await haveBaseline(project);

        const res = await postTestRun(project, imageNarrow);

        expect(res.body).toMatchObject({
          status: TestStatus.unresolved,
          diffName: null,
          diffPercent: null,
          pixelMisMatchCount: null,
        });
      },
      SLOW_TEST
    );

    it(
      'compares a different size when failOnLayoutDiff is off',
      async () => {
        const project = await haveProject(
          ImageComparison.odiff,
          JSON.stringify({ outputDiffMask: true, failOnLayoutDiff: false, threshold: 0, antialiasing: true })
        );
        await haveBaseline(project);

        const res = await postTestRun(project, imageNarrow);

        expect(res.body).toMatchObject({
          status: TestStatus.unresolved,
          pixelMisMatchCount: 60 * SIZE,
          diffPercent: 16.67,
        });
        expect(diffExists(res.body.diffName)).toBe(true);
      },
      SLOW_TEST
    );

    it(
      'reads threshold from the project config',
      async () => {
        // a partial config replaces the defaults instead of being merged into them
        const project = await haveProject(ImageComparison.odiff, JSON.stringify({ threshold: 1 }));
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited);

        // the maximum colour threshold treats every changed pixel as equal
        expect(res.body).toMatchObject({
          status: TestStatus.ok,
          diffPercent: 0,
          pixelMisMatchCount: 0,
          diffName: null,
        });
      },
      SLOW_TEST
    );

    it(
      'treats a missing baseline file as no baseline',
      async () => {
        const project = await haveProject(ImageComparison.odiff);
        const baselineName = await haveBaseline(project);
        await fs.unlink(hddService.getImagePath(baselineName));

        const res = await postTestRun(project, imageEdited);

        expect(res.body).toMatchObject({ status: TestStatus.new, diffName: null, diffPercent: null });
      },
      SLOW_TEST
    );

    it(
      'fails the request when storage is not HDD',
      async () => {
        const project = await haveProject(ImageComparison.odiff);
        await haveBaseline(project);
        const previous = process.env.STATIC_SERVICE;
        process.env.STATIC_SERVICE = 's3';
        try {
          const res = await postTestRun(project, imageEdited, {}, 500);
          expect(res.body.message).toBe(
            'Odiff can only be used with HDD static service. Please use another image comparison lib in project settings or switch STATIC_SERVICE envitonmental variable to HDD.'
          );
        } finally {
          if (previous === undefined) {
            delete process.env.STATIC_SERVICE;
          } else {
            process.env.STATIC_SERVICE = previous;
          }
        }
        // NOTE: current behavior — the run was stored before the comparison failed, so a
        // run that will never get a verdict stays in the build as "new"
        const runs = await prismaService.testRun.findMany({
          where: { projectId: project.id },
          orderBy: { createdAt: 'asc' },
        });
        expect(runs.map((run) => run.status)).toEqual([TestStatus.approved, TestStatus.new]);
      },
      SLOW_TEST
    );
  });

  describe.each([ImageComparison.lookSame, ImageComparison.odiff])('%s on a feature branch', (imageComparison) => {
    it(
      'auto-approves a run that matches an older main-branch baseline, and compares without keeping diffs',
      async () => {
        const created = await haveProject(imageComparison);
        const project = await prismaService.project.update({
          where: { id: created.id },
          data: { autoApproveFeature: true },
        });
        await haveBaseline(project, image);
        // a second approval on main: the variation's baseline history is now [edited, image]
        const res = await postTestRun(project, imageEdited);
        expect(res.body.status).toBe(TestStatus.unresolved);
        await testRunsService.approve(res.body.id);

        const matching = await postTestRun(project, image, { branchName: 'feature' });
        // compared with the older baseline with saveDiffAsFile off, then auto-approved
        expect(matching.body.status).toBe(TestStatus.autoApproved);

        const other = await postTestRun(project, imageEdited2, { branchName: 'feature' });
        expect(other.body.status).toBe(TestStatus.unresolved);
        // the diff kept is the one against the current baseline
        expect(diffExists(other.body.diffName)).toBe(true);
      },
      SLOW_TEST
    );
  });

  describe('vlm', () => {
    const vlmConfig = JSON.stringify({ provider: 'ollama', model: 'llava:7b', prompt: 'compare', temperature: 0 });

    it(
      'ok for the same image without asking the model',
      async () => {
        const generate = jest.spyOn(ollamaService, 'generate');
        const project = await haveProject(ImageComparison.vlm, vlmConfig);
        await haveBaseline(project);

        const res = await postTestRun(project, image);

        expect(res.body).toMatchObject({ status: TestStatus.ok, diffName: null, vlmDescription: null });
        expect(generate).not.toHaveBeenCalled();
      },
      SLOW_TEST
    );

    it.each([
      [true, TestStatus.ok],
      [false, TestStatus.unresolved],
    ])(
      'model says identical=%s -> %s, keeping the pixel diff',
      async (identical, status) => {
        const generate = jest
          .spyOn(ollamaService, 'generate')
          .mockResolvedValue({ content: JSON.stringify({ identical, description: 'Button moved' }) });
        const project = await haveProject(ImageComparison.vlm, vlmConfig);
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited);

        expect(res.body.status).toBe(status);
        expect(res.body.vlmDescription).toBe('Button moved');
        expect(res.body.pixelMisMatchCount).toBeGreaterThan(0);
        expect(diffExists(res.body.diffName)).toBe(true);
        expect(generate).toHaveBeenCalledWith({ ...VLM_DEFAULT_CONFIG, ...JSON.parse(vlmConfig) }, [
          expect.any(Uint8Array),
          expect.any(Uint8Array),
          expect.any(Uint8Array),
        ]);
      },
      SLOW_TEST
    );

    it(
      'reads the verdict from thinking when useThinking is set',
      async () => {
        jest
          .spyOn(ollamaService, 'generate')
          .mockResolvedValue({ content: '', thinking: JSON.stringify({ identical: true, description: 'Same' }) });
        const project = await haveProject(
          ImageComparison.vlm,
          JSON.stringify({ ...JSON.parse(vlmConfig), useThinking: true })
        );
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited);

        expect(res.body).toMatchObject({ status: TestStatus.ok, vlmDescription: 'Same' });
      },
      SLOW_TEST
    );

    it.each([
      [
        { content: 'They look the same to me' },
        `VLM analysis failed: Unexpected token 'T', "They look "... is not valid JSON`,
      ],
      [{ content: '', thinking: '' }, 'VLM analysis failed: Empty response from model'],
    ])(
      'keeps the pixelmatch verdict when the model answers %j',
      async (answer, description) => {
        jest.spyOn(ollamaService, 'generate').mockResolvedValue(answer);
        const project = await haveProject(ImageComparison.vlm, vlmConfig);
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited);

        expect(res.body.status).toBe(TestStatus.unresolved);
        expect(res.body.vlmDescription).toBe(description);
      },
      SLOW_TEST
    );

    it(
      'keeps the pixelmatch verdict when Ollama is unreachable',
      async () => {
        // the Ollama client is created lazily from OLLAMA_BASE_URL on first use
        const previous = process.env.OLLAMA_BASE_URL;
        process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${await closedPort()}`;
        try {
          const project = await haveProject(ImageComparison.vlm, vlmConfig);
          await haveBaseline(project);

          const res = await postTestRun(project, imageEdited);

          expect(res.body.status).toBe(TestStatus.unresolved);
          expect(res.body.vlmDescription).toBe('VLM analysis failed: fetch failed');
          expect(diffExists(res.body.diffName)).toBe(true);
        } finally {
          if (previous === undefined) {
            delete process.env.OLLAMA_BASE_URL;
          } else {
            process.env.OLLAMA_BASE_URL = previous;
          }
        }
      },
      SLOW_TEST
    );

    it(
      'keeps the pixelmatch verdict when the Gemini config has no API key',
      async () => {
        const project = await haveProject(
          ImageComparison.vlm,
          JSON.stringify({ provider: 'gemini', model: 'gemini-2.0-flash', prompt: 'compare', temperature: 0 })
        );
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited);

        expect(res.body.status).toBe(TestStatus.unresolved);
        expect(res.body.vlmDescription).toBe('VLM analysis failed: Gemini API key is required');
      },
      SLOW_TEST
    );

    it(
      'sends the project config as is when it is not a VLM config',
      async () => {
        const generate = jest
          .spyOn(ollamaService, 'generate')
          .mockResolvedValue({ content: JSON.stringify({ identical: false, description: 'Changed' }) });
        // no imageComparisonConfig: the column default is a pixelmatch config
        const project = await projectsService.create({
          ...projectBody(ImageComparison.vlm, undefined as unknown as string),
        });
        projectIds.push(project.id);
        await haveBaseline(project);

        const res = await postTestRun(project, imageEdited);

        expect(res.body).toMatchObject({ status: TestStatus.unresolved, vlmDescription: 'Changed' });
        // the column default is pixelmatch's, laid over the VLM defaults: Ollama still gets a model and a prompt
        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate.mock.calls[0][0]).toMatchObject({
          model: VLM_DEFAULT_CONFIG.model,
          prompt: VLM_DEFAULT_CONFIG.prompt,
          temperature: VLM_DEFAULT_CONFIG.temperature,
        });
      },
      SLOW_TEST
    );
  });
});
