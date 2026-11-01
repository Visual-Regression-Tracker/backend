import { nonNegativeNumber, positiveNumber } from './env';

describe('nonNegativeNumber', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['not a number', 'abc'],
    ['negative', '-1'],
    ['infinite', 'Infinity'],
  ])('falls back when the value is %s', (_title, raw) => {
    expect(nonNegativeNumber(raw, 7)).toBe(7);
  });

  it.each([
    ['0', 0],
    ['12', 12],
    [' 3.5 ', 3.5],
  ])('accepts %j', (raw, expected) => {
    expect(nonNegativeNumber(raw, 7)).toBe(expected);
  });
});

describe('positiveNumber', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '  '],
    ['zero', '0'],
    ['negative', '-5'],
    ['not a number', 'soon'],
    ['infinite', 'Infinity'],
  ])('falls back when the value is %s', (_title, raw) => {
    expect(positiveNumber(raw, 9)).toBe(9);
  });

  it.each([
    ['1', 1],
    ['2500', 2500],
    ['0.5', 0.5],
  ])('accepts %j', (raw, expected) => {
    expect(positiveNumber(raw, 9)).toBe(expected);
  });
});
