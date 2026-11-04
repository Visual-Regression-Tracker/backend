import { analyse, cases, closeBench } from './bench';
import { BLUR_LABELLED_NOISE, LABELLED_NOISE } from './bugs-labelled-noise';

describe('noise hint on regressions, real browser screenshots', () => {
  const bugs = cases.filter((c) => c.bug);

  afterAll(closeBench);

  it.each(bugs)('labels a regression as the lists say: $name', async (c) => {
    const result = await analyse(c);

    expect({
      blur: result.blur?.verdict,
      overall: result.verdict,
    }).toEqual({
      blur: c.name in BLUR_LABELLED_NOISE ? 'noise' : 'change',
      overall: c.name in LABELLED_NOISE ? 'noise' : 'change',
    });
  });

  it('lists 28 bugs that blur alone labels noise', () => {
    expect(Object.keys(BLUR_LABELLED_NOISE)).toHaveLength(28);
  });

  it('lists 18 bugs that the overall verdict labels noise', () => {
    expect(Object.keys(LABELLED_NOISE)).toHaveLength(18);
  });

  it('lists only bug cases the fixtures hold', () => {
    const names = new Set(bugs.map((c) => c.name));

    expect([...Object.keys(BLUR_LABELLED_NOISE), ...Object.keys(LABELLED_NOISE)].filter((n) => !names.has(n))).toEqual(
      []
    );
  });

  it('lists every bug the overall verdict labels noise among those blur labels noise', () => {
    expect(Object.keys(LABELLED_NOISE).filter((name) => !(name in BLUR_LABELLED_NOISE))).toEqual([]);
  });
});
