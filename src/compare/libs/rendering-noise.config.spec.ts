import { withoutRenderingNoiseFlag } from './rendering-noise.config';
import { PixelmatchConfig } from './pixelmatch/pixelmatch.types';

describe('withoutRenderingNoiseFlag', () => {
  it('returns a config that does not mention the flag as it is', () => {
    const config: PixelmatchConfig = { threshold: 0.1, ignoreAntialiasing: true };

    expect(withoutRenderingNoiseFlag(config)).toEqual(config);
  });

  it("keeps the removed filter's key out of the comparator's config", () => {
    expect(withoutRenderingNoiseFlag({ strict: false, ignoreRenderingNoise: true })).toEqual({ strict: false });
  });
});
