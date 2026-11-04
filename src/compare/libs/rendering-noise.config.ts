export interface RenderingNoiseConfig {
  ignoreRenderingNoise?: boolean;
}

export function hasRenderingNoiseFlag(config: object): boolean {
  return 'ignoreRenderingNoise' in config;
}

export function withoutRenderingNoiseFlag<T extends object>(config: T & RenderingNoiseConfig): T {
  const { ignoreRenderingNoise: _removed, ...comparatorConfig } = config;
  return comparatorConfig as T;
}
