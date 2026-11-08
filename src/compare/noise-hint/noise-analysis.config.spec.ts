import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_NOISE_ANALYSIS_CONFIG, parseNoiseAnalysisConfig } from './noise-analysis.config';

describe('parseNoiseAnalysisConfig', () => {
  it('pins the values the benchmark was calibrated on', () => {
    expect(DEFAULT_NOISE_ANALYSIS_CONFIG).toEqual({
      blur: { enabled: false, amplitudeThreshold: 80, solidShareMax: 0.01 },
      dinov2: { enabled: false, distanceThreshold: 0.15 },
    });
  });

  it('matches the default of Project.noiseAnalysisConfig in the Prisma schema', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
    const line = schema.split('\n').find((l) => l.trim().startsWith('noiseAnalysisConfig'));

    expect(line).toContain(`@default(${JSON.stringify(JSON.stringify(DEFAULT_NOISE_ANALYSIS_CONFIG))})`);
  });

  it.each([[''], ['not json'], ['{}'], ['null'], ['[]'], ['42'], ['"text"']])(
    'falls back to the defaults for %p',
    (json) => {
      expect(parseNoiseAnalysisConfig(json)).toEqual(DEFAULT_NOISE_ANALYSIS_CONFIG);
    }
  );

  it('does not hand out the shared defaults object', () => {
    const parsed = parseNoiseAnalysisConfig('{}');
    parsed.blur.amplitudeThreshold = 1;

    expect(DEFAULT_NOISE_ANALYSIS_CONFIG.blur.amplitudeThreshold).toBe(80);
  });

  it('takes the given values and fills the missing ones from the defaults', () => {
    const parsed = parseNoiseAnalysisConfig('{"blur":{"amplitudeThreshold":120},"dinov2":{"distanceThreshold":0.15}}');

    expect(parsed).toEqual({
      blur: { enabled: false, amplitudeThreshold: 120, solidShareMax: 0.01 },
      dinov2: { enabled: false, distanceThreshold: 0.15 },
    });
  });

  it('skips unknown keys at both levels', () => {
    const parsed = parseNoiseAnalysisConfig(
      '{"extra":1,"blur":{"amplitudeThreshold":90,"sigma":2},"dinov2":{"distanceThreshold":0.2,"model":"x"},"third":{"enabled":true}}'
    );

    expect(parsed).toEqual({
      blur: { enabled: false, amplitudeThreshold: 90, solidShareMax: 0.01 },
      dinov2: { enabled: false, distanceThreshold: 0.2 },
    });
  });

  it.each([
    ['negative amplitudeThreshold', '{"blur":{"amplitudeThreshold":-5}}'],
    ['zero amplitudeThreshold', '{"blur":{"amplitudeThreshold":0}}'],
    ['string amplitudeThreshold', '{"blur":{"amplitudeThreshold":"80"}}'],
    ['null amplitudeThreshold', '{"blur":{"amplitudeThreshold":null}}'],
    ['negative solidShareMax', '{"blur":{"solidShareMax":-0.1}}'],
    ['array solidShareMax', '{"blur":{"solidShareMax":[1]}}'],
    ['negative distanceThreshold', '{"dinov2":{"distanceThreshold":-0.15}}'],
    ['zero distanceThreshold', '{"dinov2":{"distanceThreshold":0}}'],
    ['boolean distanceThreshold', '{"dinov2":{"distanceThreshold":true}}'],
    ['non-boolean blur.enabled', '{"blur":{"enabled":"yes"}}'],
    ['non-boolean dinov2.enabled', '{"dinov2":{"enabled":1}}'],
    ['non-object blur', '{"blur":5}'],
    ['array dinov2', '{"dinov2":[]}'],
  ])('uses the default for %s', (_name, json) => {
    expect(parseNoiseAnalysisConfig(json)).toEqual(DEFAULT_NOISE_ANALYSIS_CONFIG);
  });

  it('keeps an explicit enabled:true when other fields are missing', () => {
    const parsed = parseNoiseAnalysisConfig('{"blur":{"enabled":true}}');

    expect(parsed.blur).toEqual({ enabled: true, amplitudeThreshold: 80, solidShareMax: 0.01 });
    expect(parsed.dinov2.enabled).toBe(false);
  });

  it('keeps zero for solidShareMax', () => {
    expect(parseNoiseAnalysisConfig('{"blur":{"solidShareMax":0}}').blur.solidShareMax).toBe(0);
  });

  it('keeps the valid keys next to an invalid one', () => {
    const parsed = parseNoiseAnalysisConfig('{"blur":{"amplitudeThreshold":-1,"solidShareMax":0.05,"enabled":false}}');

    expect(parsed.blur).toEqual({ enabled: false, amplitudeThreshold: 80, solidShareMax: 0.05 });
  });
});
