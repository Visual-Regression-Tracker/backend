import { Prisma } from '@prisma/client';
import { isPrismaError } from './prisma-errors';

describe('isPrismaError', () => {
  const known = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' });

  it('matches a known request error with the same code', () => {
    expect(isPrismaError(known('P2002'), 'P2002')).toBe(true);
  });

  it('rejects a known request error with another code', () => {
    expect(isPrismaError(known('P2003'), 'P2002')).toBe(false);
  });

  it('rejects look-alikes and non-errors', () => {
    expect(isPrismaError({ code: 'P2002' }, 'P2002')).toBe(false);
    expect(isPrismaError(new Error('P2002'), 'P2002')).toBe(false);
    expect(isPrismaError(undefined, 'P2002')).toBe(false);
  });
});
