export interface RenderingNoiseConfig {
  ignoreRenderingNoise?: boolean;
}

export function splitRenderingNoiseConfig<T extends RenderingNoiseConfig>(
  config: T
): { ignoreRenderingNoise: boolean; comparatorConfig: T } {
  const { ignoreRenderingNoise, ...comparatorConfig } = config;
  return { ignoreRenderingNoise: ignoreRenderingNoise === true, comparatorConfig: comparatorConfig as T };
}
