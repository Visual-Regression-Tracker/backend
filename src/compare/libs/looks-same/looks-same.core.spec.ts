import { readFileSync } from 'fs';
import { join } from 'path';
import { PNG } from 'pngjs';
import { pngBytes, solidPng } from '../../test-utils';
import { computeLooksSame, LOOKS_SAME_DEFAULT_CONFIG, LooksSameJobInput } from './looks-same.core';

const fixture = (name: string) => readFileSync(join(__dirname, '../../../../test', name));

const filled = (width: number, height: number, value: number): Buffer =>
  pngBytes(solidPng(width, height, [value, value, value]));

const job = (overrides: Partial<LooksSameJobInput> = {}): LooksSameJobInput => ({
  kind: 'looks-same',
  baseline: fixture('image.png'),
  image: fixture('image_edited.png'),
  ignoreAreas: [],
  config: LOOKS_SAME_DEFAULT_CONFIG,
  saveDiff: false,
  ...overrides,
});

describe('computeLooksSame', () => {
  it('reports an unreadable baseline', async () => {
    await expect(computeLooksSame(job({ baseline: Buffer.from('nope') }))).resolves.toStrictEqual({
      outcome: 'baseline-unreadable',
    });
  });

  it('reports an unreadable image', async () => {
    await expect(computeLooksSame(job({ image: Buffer.from('nope') }))).resolves.toStrictEqual({
      outcome: 'image-unreadable',
    });
  });

  it('reports a baseline that is unreadable before an unreadable image', async () => {
    const output = await computeLooksSame(job({ baseline: Buffer.from('a'), image: Buffer.from('b') }));

    expect(output).toStrictEqual({ outcome: 'baseline-unreadable' });
  });

  it('does not call a 60x30 and a 30x60 image of the same pixel bytes equal', async () => {
    const output = await computeLooksSame(job({ baseline: filled(60, 30, 128), image: filled(30, 60, 128) }));

    expect(output).toStrictEqual({ outcome: 'diff-dimension' });
  });

  it('compares them when other sizes are allowed', async () => {
    const output = await computeLooksSame(
      job({
        baseline: filled(60, 30, 128),
        image: filled(30, 60, 128),
        config: { ...LOOKS_SAME_DEFAULT_CONFIG, allowDiffDimensions: true },
      })
    );

    expect(output).toMatchObject({ outcome: 'compared', isSameDimension: false });
  });

  it('answers equal for the same pixels', async () => {
    const output = await computeLooksSame(job({ baseline: filled(10, 10, 7), image: filled(10, 10, 7) }));

    expect(output).toStrictEqual({ outcome: 'equal' });
  });

  it('counts the different pixels of the fixtures', async () => {
    const output = await computeLooksSame(job());

    expect(output).toStrictEqual({
      outcome: 'compared',
      isSameDimension: true,
      result: { equal: false, differentPixels: 31068, totalPixels: 129600 },
      errors: [],
    });
  });

  it('returns the diff image when asked to', async () => {
    const output = await computeLooksSame(job({ saveDiff: true }));

    expect(output.outcome).toBe('compared');
    const diffPng = (output as { diffPng?: Uint8Array }).diffPng!;
    expect(diffPng).toBeInstanceOf(Uint8Array);
    const diff = PNG.sync.read(Buffer.from(diffPng));
    expect([diff.width, diff.height]).toEqual([360, 360]);
  });

  it('returns no diff image for an equal result even when asked to', async () => {
    const baseline = filled(10, 10, 255);
    const changed = PNG.sync.read(baseline);
    changed.data[0] = 0;

    const output = await computeLooksSame(
      job({
        baseline,
        image: PNG.sync.write(changed),
        ignoreAreas: [{ x: 0, y: 0, width: 1, height: 1 }],
        saveDiff: true,
      })
    );

    expect(output).toStrictEqual({
      outcome: 'compared',
      isSameDimension: true,
      result: { equal: true, differentPixels: undefined, totalPixels: undefined },
      errors: [],
    });
  });

  it('falls back to the defaults when looks-same refuses the project config', async () => {
    const output = await computeLooksSame(
      job({ config: { ...LOOKS_SAME_DEFAULT_CONFIG, strict: true, tolerance: 5 } })
    );

    expect(output).toMatchObject({
      outcome: 'compared',
      result: { equal: false, differentPixels: 31068, totalPixels: 129600 },
      errors: [
        'Unable to use "strict" and "tolerance" options together',
        'Looks-Same cannot compare with the project config, fallback to default one',
      ],
    });
  });

  it('masks the ignore areas of both images before comparing', async () => {
    const baseline = filled(10, 10, 255);
    const changed = PNG.sync.read(baseline);
    changed.data[0] = 0;
    changed.data[4 * 55] = 0;

    const output = await computeLooksSame(
      job({
        baseline,
        image: PNG.sync.write(changed),
        ignoreAreas: [{ x: 0, y: 0, width: 1, height: 1 }],
        config: { strict: true, ignoreAntialiasing: false, ignoreCaret: false },
      })
    );

    expect(output).toMatchObject({
      outcome: 'compared',
      result: { equal: false, differentPixels: 1, totalPixels: 100 },
    });
  });

  it('produces an output that survives structured cloning', async () => {
    const output = await computeLooksSame(job({ saveDiff: true }));

    const clone = structuredClone(output) as { diffPng: Uint8Array };

    expect(clone).toStrictEqual(output);
    expect(clone.diffPng.byteLength).toBeGreaterThan(0);
  });
});

describe('computeLooksSame when looks-same fails', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('looks-same');
  });

  it('gives no result and all three messages when the defaults fail too', async () => {
    jest.resetModules();
    jest.doMock('looks-same', () => ({
      __esModule: true,
      default: jest.fn().mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second')),
    }));
    const core: typeof import('./looks-same.core') = require('./looks-same.core');

    const output = await core.computeLooksSame(job());

    expect(output).toStrictEqual({
      outcome: 'compared',
      isSameDimension: true,
      result: null,
      errors: ['first', 'Looks-Same cannot compare with the project config, fallback to default one', 'second'],
    });
  });
});
