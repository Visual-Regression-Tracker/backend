import { readNoiseAnalysis } from './noise-analysis.types';

describe('readNoiseAnalysis', () => {
  it.each([null, 'text', 3, true, []])('returns null for %j', (value) => {
    expect(readNoiseAnalysis(value)).toBeNull();
  });

  it('reads a pending marker', () => {
    expect(readNoiseAnalysis({ pending: true, requestedAt: '2026-11-04T10:00:00.000Z' })).toEqual({
      pending: true,
      requestedAt: '2026-11-04T10:00:00.000Z',
    });
  });

  it('returns null for a pending marker without a time', () => {
    expect(readNoiseAnalysis({ pending: true })).toBeNull();
  });

  it('passes a stored result through', () => {
    const result = { version: 1, verdict: 'noise' };

    expect(readNoiseAnalysis(result)).toBe(result);
  });
});
