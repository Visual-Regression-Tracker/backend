import { TestStatus } from '@prisma/client';
import { cases, verdict } from './bench';
import { KNOWN_FALSE_PASSES } from './known-misses';

describe('rendering-noise filter with pixelmatch defaults, on real browser screenshots', () => {
  const bugs = cases.filter((c) => c.bug);

  it.each(bugs.filter((c) => !(c.name in KNOWN_FALSE_PASSES)))('sends a regression to review: $name', async (c) =>
    expect(await verdict(c)).toBe(TestStatus.unresolved)
  );

  it.each(bugs.filter((c) => c.name in KNOWN_FALSE_PASSES))('known false pass: $name', async (c) =>
    expect(await verdict(c)).toBe(TestStatus.ok)
  );

  it('lists only bug cases the fixtures hold', () => {
    const names = new Set(bugs.map((c) => c.name));

    expect(Object.keys(KNOWN_FALSE_PASSES).filter((name) => !names.has(name))).toEqual([]);
  });
});
