import { PrismaClient } from '@prisma/client';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';

import prisma from '../client';

jest.mock('../client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
  prepareConnection: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockReset(prismaMock);
});

export const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
