export interface RenderingNoiseConfig {
  ignoreRenderingNoise?: boolean;
}

export function splitRenderingNoiseConfig<T extends object>(
  config: T & RenderingNoiseConfig
): { ignoreRenderingNoise: boolean; comparatorConfig: T } {
  const { ignoreRenderingNoise, ...comparatorConfig } = config;
  return { ignoreRenderingNoise: ignoreRenderingNoise === true, comparatorConfig: comparatorConfig as T };
}
