import { splitRenderingNoiseConfig } from './rendering-noise.config';
import { PixelmatchConfig } from './pixelmatch/pixelmatch.types';

describe('splitRenderingNoiseConfig', () => {
  it('leaves the filter off when the config does not mention it', () => {
    const config: PixelmatchConfig = { threshold: 0.1, ignoreAntialiasing: true };

    const { ignoreRenderingNoise, comparatorConfig } = splitRenderingNoiseConfig(config);

    expect(ignoreRenderingNoise).toBe(false);
    expect(comparatorConfig).toEqual(config);
  });

  it('turns it on', () => {
    expect(splitRenderingNoiseConfig({ ignoreRenderingNoise: true }).ignoreRenderingNoise).toBe(true);
  });

  it.each([['true'], [1], [false]])('stays off for ignoreRenderingNoise %p', (value) => {
    expect(splitRenderingNoiseConfig({ ignoreRenderingNoise: value as boolean }).ignoreRenderingNoise).toBe(false);
  });

  it("keeps the filter's key out of the comparator's config", () => {
    const { comparatorConfig } = splitRenderingNoiseConfig({ strict: false, ignoreRenderingNoise: true });

    expect(comparatorConfig).toEqual({ strict: false });
  });
});
