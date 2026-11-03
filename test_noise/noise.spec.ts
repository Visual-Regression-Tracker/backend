import { TestStatus } from '@prisma/client';
import { cases, verdict } from './bench';

describe('rendering-noise filter with pixelmatch defaults, on real browser screenshots', () => {
  it.each(cases.filter((c) => !c.bug))('passes rendering noise: $name', async (c) =>
    expect(await verdict(c)).toBe(TestStatus.ok)
  );
});
