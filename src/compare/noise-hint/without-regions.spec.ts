import { withoutRegions } from './without-regions';
import { NoiseAnalysisPending, NoiseAnalysisResult } from './noise-analysis.types';

const regions = [{ x: 1, y: 2, width: 3, height: 4, weight: 0.5 }];

const result = (overrides: Partial<NoiseAnalysisResult> = {}): NoiseAnalysisResult => ({
  version: 1,
  verdict: 'noise',
  score: 0.2,
  reason: null,
  config: { blur: { amplitudeThreshold: 80, solidShareMax: 0.01 }, dinov2: { distanceThreshold: 0.15 } },
  blur: { verdict: 'noise', score: 0.1, signals: { amplitude: 1, solidShare: 0, density: 0.3 }, regions },
  dinov2: { verdict: 'noise', score: 0.2, signals: { distance: 0.05, patches: 9 }, regions },
  computedAt: '2026-11-04T10:00:00.000Z',
  ...overrides,
});

describe('withoutRegions', () => {
  it('passes null through', () => {
    expect(withoutRegions(null)).toBeNull();
  });

  it.each([
    ['a string', 'text'],
    ['a number', 3],
    ['an array', []],
  ])('returns null for %s', (_, value) => {
    expect(withoutRegions(value as unknown as NoiseAnalysisResult)).toBeNull();
  });

  it('passes the pending marker through unchanged', () => {
    const pending: NoiseAnalysisPending = { pending: true, requestedAt: '2026-11-04T10:00:00.000Z' };

    expect(withoutRegions(pending)).toEqual(pending);
  });

  it('removes the regions of both stages and keeps everything else', () => {
    const analysis = result();

    const stripped = withoutRegions(analysis);

    expect(stripped).toEqual({
      ...analysis,
      blur: { verdict: 'noise', score: 0.1, signals: { amplitude: 1, solidShare: 0, density: 0.3 } },
      dinov2: { verdict: 'noise', score: 0.2, signals: { distance: 0.05, patches: 9 } },
    });
    expect(JSON.stringify(stripped)).not.toContain('regions');
  });

  it('does not modify the stored object', () => {
    const analysis = result();

    withoutRegions(analysis);

    expect(analysis.blur?.regions).toBe(regions);
  });

  it.each([{ skipped: 'blur sees a change' }, { skipped: 'off' }, { error: 'dinov2 unavailable' }] as const)(
    'leaves the second stage %j untouched',
    (dinov2) => {
      const analysis = result({ verdict: 'change', dinov2 });

      expect(withoutRegions(analysis)).toMatchObject({ dinov2 });
    }
  );

  it('keeps missing stages and the unknown reason', () => {
    const analysis = result({ verdict: 'unknown', score: null, reason: 'sizes differ', blur: null, dinov2: null });

    expect(withoutRegions(analysis)).toEqual(analysis);
  });

  it.each([
    ['no stages', { version: 1, verdict: 'noise' }],
    ['no first stage', { version: 1, verdict: 'noise', dinov2: { skipped: 'off' } }],
    ['a non-object second stage', { version: 1, verdict: 'noise', blur: null, dinov2: 'off' }],
  ])('passes a stored result with %s through unchanged', (_, stored) => {
    expect(withoutRegions(stored)).toEqual(stored);
  });

  it('returns a result without a pending flag unchanged', () => {
    expect(withoutRegions({ pending: false })).toEqual({ pending: false });
  });
});
