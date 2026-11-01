import { INestApplication } from '@nestjs/common';
import { ImageComparison, Project, TestStatus } from '@prisma/client';
import { existsSync, readFileSync, promises as fs } from 'fs';
import { createServer } from 'net';
import { PNG } from 'pngjs';
import { randomUUID } from 'crypto';
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
import { createE2eApp, withEnv } from './api-helpers';
import { haveUserLogged, requestWithApiKey, requestWithAuth, LoggedUser } from './preconditions';

const SIZE = 360;
const TOTAL_PIXELS = SIZE * SIZE;
const SLOW_TEST = 90000;

const image = readFileSync('./test/image.png');
const imageEdited = readFileSync('./test/image_edited.png');
const imageEdited2 = readFileSync('./test/image_edited_2.png');

const cropWidth = (buffer: Buffer, width: number): Buffer => {
  const source = PNG.sync.read(buffer);
  const target = new PNG({ width, height: source.height });
  PNG.bitblt(source, target, 0, 0, width, source.height, 0, 0);
  return PNG.sync.write(target);
};
const imageNarrow = cropWidth(image, 300);

const slow = (name: string, fn: () => Promise<void>) => it(name, fn, SLOW_TEST);

const NO_DIFF = { status: TestStatus.ok, diffPercent: 0, pixelMisMatchCount: 0, diffName: null };
const NO_NUMBERS = { status: TestStatus.unresolved, diffName: null, diffPercent: null, pixelMisMatchCount: null };

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
    const created = await createE2eApp();
    app = created.app;
    usersService = created.get(UsersService);
    projectsService = created.get(ProjectsService);
    buildsService = created.get(BuildsService);
    testRunsService = created.get(TestRunsService);
    hddService = created.get(HddService);
    prismaService = created.get(PrismaService);
    ollamaService = created.get(OllamaService);
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
    name: `Comparators E2E ${imageComparison} ${randomUUID()}`,
    mainBranchName: 'master',
    autoApproveFeature: false,
    imageComparison,
    imageComparisonConfig,
    maxBuildAllowed: 100,
    maxBranchLifetime: 30,
    bulkApproveVariations: false,
    bulkApproveGroupBy: 'customTags',
  });

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

  const haveBaseline = async (project: Project, imageBuffer: Buffer = image): Promise<string> => {
    const res = await postTestRun(project, imageBuffer);
    expect(res.body.status).toBe(TestStatus.new);
    const approved = await testRunsService.approve(res.body.id);
    const baselineName = (await prismaService.testVariation.findUnique({ where: { id: approved.testVariationId! } }))!
      .baselineName!;
    expect(diffExists(baselineName)).toBe(true);
    return baselineName;
  };

  const compare = async (
    imageComparison: ImageComparison,
    imageComparisonConfig: string | undefined,
    candidate: Buffer,
    extra: Parameters<typeof postTestRun>[2] = {}
  ) => {
    const project = await haveProject(imageComparison, imageComparisonConfig);
    await haveBaseline(project);
    return { project, res: await postTestRun(project, candidate, extra) };
  };

  describe.each([
    {
      comparator: ImageComparison.lookSame,
      changedCount: 31068,
      changedPercent: (31068 * 100) / TOTAL_PIXELS,
      resizedConfig: { allowDiffDimensions: true },
      resizedPercent: (60 * SIZE * 100) / TOTAL_PIXELS,
      lenientConfig: { tolerance: 100 },
    },
    {
      comparator: ImageComparison.odiff,
      changedCount: 31145,
      changedPercent: 24.03,
      resizedConfig: { outputDiffMask: true, failOnLayoutDiff: false, threshold: 0, antialiasing: true },
      resizedPercent: 16.67,
      lenientConfig: { threshold: 1 },
    },
  ])('$comparator', ({ comparator, changedCount, changedPercent, resizedConfig, resizedPercent, lenientConfig }) => {
    slow('ok for the same image', async () => {
      const { res } = await compare(comparator, undefined, image);

      expect(res.body).toMatchObject(NO_DIFF);
    });

    slow('unresolved with a diff file for a changed image', async () => {
      const { res } = await compare(comparator, undefined, imageEdited);

      expect(res.body).toMatchObject({
        status: TestStatus.unresolved,
        pixelMisMatchCount: changedCount,
        diffPercent: changedPercent,
        imageThumbnailName: null,
        diffThumbnailName: null,
      });
      expect(res.body.diffName).toMatch(/\.diff\.png$/);
      expect(diffExists(res.body.diffName)).toBe(true);
      const diff = PNG.sync.read(await fs.readFile(hddService.getImagePath(res.body.diffName)));
      expect([diff.width, diff.height]).toEqual([SIZE, SIZE]);
    });

    slow('ok, without a diff, when the change is within diffTollerancePercent', async () => {
      const { res } = await compare(comparator, undefined, imageEdited, { diffTollerancePercent: 100 });

      expect(res.body).toMatchObject({
        diffTollerancePercent: 100,
        status: TestStatus.ok,
        diffName: null,
        pixelMisMatchCount: changedCount,
        diffPercent: changedPercent,
      });
    });

    slow('unresolved when the change is over diffTollerancePercent', async () => {
      const { res } = await compare(comparator, undefined, imageEdited, { diffTollerancePercent: 0.01 });

      expect(res.body.status).toBe(TestStatus.unresolved);
      expect(diffExists(res.body.diffName)).toBe(true);
    });

    slow('ok when an ignore area covers the whole change', async () => {
      const { res } = await compare(comparator, undefined, imageEdited, { ignoreAreas: WHOLE_IMAGE });

      expect(res.body).toMatchObject(NO_DIFF);
    });

    slow('unresolved without numbers for a different size', async () => {
      const { res } = await compare(comparator, undefined, imageNarrow);

      expect(res.body).toMatchObject(NO_NUMBERS);
    });

    slow('compares a different size when the project config allows it', async () => {
      const { res } = await compare(comparator, JSON.stringify(resizedConfig), imageNarrow);

      expect(res.body).toMatchObject({
        status: TestStatus.unresolved,
        pixelMisMatchCount: 60 * SIZE,
        diffPercent: resizedPercent,
      });
      expect(diffExists(res.body.diffName)).toBe(true);
    });

    slow('reads the tolerance from the project config', async () => {
      const { res } = await compare(comparator, JSON.stringify(lenientConfig), imageEdited);

      expect(res.body).toMatchObject(NO_DIFF);
    });

    slow('treats a missing baseline file as no baseline', async () => {
      const project = await haveProject(comparator);
      await fs.unlink(hddService.getImagePath(await haveBaseline(project)));

      const res = await postTestRun(project, imageEdited);

      expect(res.body).toMatchObject({ status: TestStatus.new, diffName: null, diffPercent: null });
    });
  });

  describe('vlm with a Gemini key', () => {
    const key = 'AIzaSy-e2e-gemini-key-1234';
    const geminiConfig = (apiKey: string) =>
      JSON.stringify({ provider: 'gemini', model: 'gemini-2.5-flash', apiKey, prompt: 'p', temperature: 0.1 });

    const create = async () => {
      const res = await requestWithAuth(app, 'post', '/projects', user.token)
        .send(projectBody(ImageComparison.vlm, geminiConfig(key)))
        .expect(201);
      projectIds.push(res.body.id);
      return res.body;
    };
    const storedKey = async (id: string) =>
      JSON.parse((await prismaService.project.findUniqueOrThrow({ where: { id } })).imageComparisonConfig).apiKey;

    it('the projects API answers with the key masked and stores it in full', async () => {
      const created = await create();

      const listed = await requestWithAuth(app, 'get', '/projects', user.token).expect(200);

      expect(JSON.parse(created.imageComparisonConfig).apiKey).toBe('••••1234');
      const project = listed.body.find(({ id }: Project) => id === created.id);
      expect(JSON.parse(project.imageComparisonConfig).apiKey).toBe('••••1234');
      expect(await storedKey(created.id)).toBe(key);
    });

    it('saving the masked key back keeps the stored key, a new key replaces it', async () => {
      const created = await create();

      await requestWithAuth(app, 'put', '/projects', user.token)
        .send({ ...projectBody(ImageComparison.vlm, created.imageComparisonConfig), id: created.id })
        .expect(200);
      expect(await storedKey(created.id)).toBe(key);

      await requestWithAuth(app, 'put', '/projects', user.token)
        .send({ ...projectBody(ImageComparison.vlm, geminiConfig('AIzaSy-new-gemini-key-9999')), id: created.id })
        .expect(200);
      expect(await storedKey(created.id)).toBe('AIzaSy-new-gemini-key-9999');
    });
  });

  describe('lookSame', () => {
    it('the projects API rejects a config that is not JSON', async () => {
      await requestWithAuth(app, 'post', '/projects', user.token)
        .send(projectBody(ImageComparison.lookSame, 'not json'))
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toBe('imageComparisonConfig must be a json string');
        });
    });

    slow('falls back to the default config when the stored config is not JSON', async () => {
      const created = await haveProject(ImageComparison.lookSame);
      const project = await prismaService.project.update({
        where: { id: created.id },
        data: { imageComparisonConfig: 'not json' },
      });
      await haveBaseline(project);

      const res = await postTestRun(project, imageEdited);

      expect(res.body).toMatchObject({ status: TestStatus.unresolved, pixelMisMatchCount: 31068 });
      expect(diffExists(res.body.diffName)).toBe(true);
    });

    slow('falls back to the default config when looks-same rejects the config', async () => {
      const { res } = await compare(
        ImageComparison.lookSame,
        JSON.stringify({ strict: true, tolerance: 5 }),
        imageEdited
      );

      expect(res.body).toMatchObject({ status: TestStatus.unresolved, pixelMisMatchCount: 31068 });
      expect(diffExists(res.body.diffName)).toBe(true);
    });
  });

  describe('odiff', () => {
    slow('fails the request when storage is not HDD', async () => {
      const project = await haveProject(ImageComparison.odiff);
      await haveBaseline(project);

      await withEnv({ STATIC_SERVICE: 's3' }, async () => {
        const res = await postTestRun(project, imageEdited, {}, 500);
        expect(res.body.message).toBe(
          'Odiff can only be used with HDD static service. Please use another image comparison lib in project settings or switch STATIC_SERVICE envitonmental variable to HDD.'
        );
      });

      const runs = await prismaService.testRun.findMany({ where: { projectId: project.id } });
      expect(runs.map((run) => run.status)).toEqual([TestStatus.approved]);
    });
  });

  describe.each([ImageComparison.lookSame, ImageComparison.odiff])('%s on a feature branch', (imageComparison) => {
    slow(
      'auto-approves a run that matches an older main-branch baseline, and compares without keeping diffs',
      async () => {
        const created = await haveProject(imageComparison);
        const project = await prismaService.project.update({
          where: { id: created.id },
          data: { autoApproveFeature: true },
        });
        await haveBaseline(project, image);
        const res = await postTestRun(project, imageEdited);
        expect(res.body.status).toBe(TestStatus.unresolved);
        await testRunsService.approve(res.body.id);

        const matching = await postTestRun(project, image, { branchName: 'feature' });
        expect(matching.body.status).toBe(TestStatus.autoApproved);

        const other = await postTestRun(project, imageEdited2, { branchName: 'feature' });
        expect(other.body.status).toBe(TestStatus.unresolved);
        expect(diffExists(other.body.diffName)).toBe(true);
      }
    );
  });

  describe('vlm', () => {
    const vlmConfig = JSON.stringify({ provider: 'ollama', model: 'llava:7b', prompt: 'compare', temperature: 0 });
    const answer = (verdict: object) => ({ content: JSON.stringify(verdict) });

    slow('ok for the same image without asking the model', async () => {
      const generate = jest.spyOn(ollamaService, 'generate');

      const { res } = await compare(ImageComparison.vlm, vlmConfig, image);

      expect(res.body).toMatchObject({ status: TestStatus.ok, diffName: null, vlmDescription: null });
      expect(generate).not.toHaveBeenCalled();
    });

    it.each([
      [true, TestStatus.ok],
      [false, TestStatus.unresolved],
    ])(
      'model says identical=%s -> %s, keeping the pixel diff',
      async (identical, status) => {
        const generate = jest
          .spyOn(ollamaService, 'generate')
          .mockResolvedValue(answer({ identical, description: 'Button moved' }));

        const { res } = await compare(ImageComparison.vlm, vlmConfig, imageEdited);

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

    slow('reads the verdict from thinking when useThinking is set', async () => {
      jest
        .spyOn(ollamaService, 'generate')
        .mockResolvedValue({ content: '', thinking: JSON.stringify({ identical: true, description: 'Same' }) });

      const { res } = await compare(
        ImageComparison.vlm,
        JSON.stringify({ ...JSON.parse(vlmConfig), useThinking: true }),
        imageEdited
      );

      expect(res.body).toMatchObject({ status: TestStatus.ok, vlmDescription: 'Same' });
    });

    it.each([
      [
        { content: 'They look the same to me' },
        `VLM analysis failed: Unexpected token 'T', "They look "... is not valid JSON`,
      ],
      [{ content: '', thinking: '' }, 'VLM analysis failed: Empty response from model'],
    ])(
      'keeps the pixelmatch verdict when the model answers %j',
      async (response, description) => {
        jest.spyOn(ollamaService, 'generate').mockResolvedValue(response);

        const { res } = await compare(ImageComparison.vlm, vlmConfig, imageEdited);

        expect(res.body.status).toBe(TestStatus.unresolved);
        expect(res.body.vlmDescription).toBe(description);
      },
      SLOW_TEST
    );

    slow('keeps the pixelmatch verdict when Ollama is unreachable', async () => {
      await withEnv({ OLLAMA_BASE_URL: `http://127.0.0.1:${await closedPort()}` }, async () => {
        const { res } = await compare(ImageComparison.vlm, vlmConfig, imageEdited);

        expect(res.body.status).toBe(TestStatus.unresolved);
        expect(res.body.vlmDescription).toBe('VLM analysis failed: fetch failed');
        expect(diffExists(res.body.diffName)).toBe(true);
      });
    });

    slow('keeps the pixelmatch verdict when the Gemini config has no API key', async () => {
      const { res } = await compare(
        ImageComparison.vlm,
        JSON.stringify({ provider: 'gemini', model: 'gemini-2.0-flash', prompt: 'compare', temperature: 0 }),
        imageEdited
      );

      expect(res.body.status).toBe(TestStatus.unresolved);
      expect(res.body.vlmDescription).toBe('VLM analysis failed: Gemini API key is required');
    });

    slow('sends the project config as is when it is not a VLM config', async () => {
      const generate = jest
        .spyOn(ollamaService, 'generate')
        .mockResolvedValue(answer({ identical: false, description: 'Changed' }));
      const project = await projectsService.create(projectBody(ImageComparison.vlm, undefined as unknown as string));
      projectIds.push(project.id);
      await haveBaseline(project);

      const res = await postTestRun(project, imageEdited);

      expect(res.body).toMatchObject({ status: TestStatus.unresolved, vlmDescription: 'Changed' });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate.mock.calls[0][0]).toMatchObject({
        model: VLM_DEFAULT_CONFIG.model,
        prompt: VLM_DEFAULT_CONFIG.prompt,
        temperature: VLM_DEFAULT_CONFIG.temperature,
      });
    });
  });
});
