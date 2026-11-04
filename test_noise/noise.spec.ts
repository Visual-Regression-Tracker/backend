import { analyse, cases, closeBench } from './bench';

describe('noise hint on rendering noise, real browser screenshots', () => {
  afterAll(closeBench);

  it.each(cases.filter((c) => !c.bug))('is labelled noise by blur and overall: $name', async (c) => {
    const result = await analyse(c);

    expect({ blur: result.blur?.verdict, overall: result.verdict }).toEqual({ blur: 'noise', overall: 'noise' });
  });
});
