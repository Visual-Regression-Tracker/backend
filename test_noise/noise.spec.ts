import { analyse, cases, closeBench } from './bench';

describe('noise hint on rendering noise, real browser screenshots', () => {
  const noisePairs = cases.filter((c) => !c.bug);

  afterAll(closeBench);

  it('labels no noise pair a change, by blur or by the overall verdict', async () => {
    const byBlur: string[] = [];
    const overall: string[] = [];
    for (const c of noisePairs) {
      const result = await analyse(c);
      if (result.blur?.verdict !== 'noise') byBlur.push(c.name);
      if (result.verdict !== 'noise') overall.push(c.name);
    }

    expect({ byBlur, overall }).toEqual({ byBlur: [], overall: [] });
  });
});
