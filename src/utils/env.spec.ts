import { booleanFlag, nonNegativeNumber, positiveNumber } from './env';

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

describe('booleanFlag', () => {
  it.each(['true', 'TRUE', ' 1 ', 'yes', 'on'])('reads %j as true', (raw) => {
    expect(booleanFlag(raw, false)).toBe(true);
  });

  it.each(['false', 'False', '0', 'no', ' off '])('reads %j as false', (raw) => {
    expect(booleanFlag(raw, true)).toBe(false);
  });

  it.each([
    [true, true],
    [false, false],
    [1, true],
    [0, false],
  ])('reads the non-string value %p', (raw, expected) => {
    expect(booleanFlag(raw, !expected)).toBe(expected);
  });

  it.each([
    ['unset', undefined],
    ['blank', '  '],
    ['not a flag', 'maybe'],
  ])('falls back when the value is %s', (_title, raw) => {
    expect(booleanFlag(raw, true)).toBe(true);
    expect(booleanFlag(raw, false)).toBe(false);
  });
});
