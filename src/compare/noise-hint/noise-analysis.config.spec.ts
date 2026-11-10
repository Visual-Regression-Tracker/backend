import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_NOISE_ANALYSIS_CONFIG,
  NOISE_ANALYSIS_THRESHOLDS,
  parseNoiseAnalysisConfig,
} from './noise-analysis.config';

describe('parseNoiseAnalysisConfig', () => {
  it('turns both stages off by default', () => {
    expect(DEFAULT_NOISE_ANALYSIS_CONFIG).toEqual({ blur: { enabled: false }, dinov2: { enabled: false } });
  });

  it('pins the thresholds the benchmark was calibrated on', () => {
    expect(NOISE_ANALYSIS_THRESHOLDS).toEqual({
      blur: { amplitudeThreshold: 80, solidShareMax: 0.01 },
      dinov2: { distanceThreshold: 0.15 },
    });
  });

  it('reads the default of Project.noiseAnalysisConfig in the Prisma schema as the default config', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
    const line = schema.split('\n').find((l) => l.trim().startsWith('noiseAnalysisConfig')) ?? '';
    const schemaDefault = JSON.parse(/@default\(("(?:[^"\\]|\\.)*")\)/.exec(line)?.[1] ?? '""') as string;

    expect(parseNoiseAnalysisConfig(schemaDefault)).toEqual(DEFAULT_NOISE_ANALYSIS_CONFIG);
  });

  it.each([[''], ['not json'], ['{}'], ['null'], ['[]'], ['42'], ['"text"']])(
    'falls back to the defaults for %p',
    (json) => {
      expect(parseNoiseAnalysisConfig(json)).toEqual(DEFAULT_NOISE_ANALYSIS_CONFIG);
    }
  );

  it('does not hand out the shared defaults object', () => {
    const parsed = parseNoiseAnalysisConfig('{}');
    parsed.blur.enabled = true;

    expect(DEFAULT_NOISE_ANALYSIS_CONFIG.blur.enabled).toBe(false);
  });

  it('reads both switches', () => {
    expect(parseNoiseAnalysisConfig('{"blur":{"enabled":true},"dinov2":{"enabled":true}}')).toEqual({
      blur: { enabled: true },
      dinov2: { enabled: true },
    });
  });

  it('ignores the thresholds stored by release candidates and other unknown keys', () => {
    const parsed = parseNoiseAnalysisConfig(
      '{"extra":1,"blur":{"enabled":true,"amplitudeThreshold":70,"solidShareMax":0.02},"dinov2":{"enabled":false,"distanceThreshold":0.2}}'
    );

    expect(parsed).toEqual({ blur: { enabled: true }, dinov2: { enabled: false } });
  });

  it.each([
    ['non-boolean blur.enabled', '{"blur":{"enabled":"yes"}}'],
    ['non-boolean dinov2.enabled', '{"dinov2":{"enabled":1}}'],
    ['non-object blur', '{"blur":5}'],
    ['array dinov2', '{"dinov2":[]}'],
  ])('uses the default for %s', (_name, json) => {
    expect(parseNoiseAnalysisConfig(json)).toEqual(DEFAULT_NOISE_ANALYSIS_CONFIG);
  });
});
