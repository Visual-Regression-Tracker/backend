import { createDefaultPreset } from 'ts-jest';

/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    displayName: 'E2E Tests',
    roots: ['./'],
    testTimeout: 30000,
    testRegex: '.e2e-spec.ts$',
    transform: {
      ...createDefaultPreset().transform,
    },
    coverageDirectory: '../coverage',
    testEnvironment: 'node',
    // Note: moduleNameMapper is required because Jest cannot handle pure ESM modules
    // The mocks provide functional implementations that mimic real library behavior
    moduleNameMapper: {
      '^looks-same$': '<rootDir>/../src/__mocks__/looks-same.ts',
      '^pixelmatch$': '<rootDir>/../src/__mocks__/pixelmatch.ts',
    },
  };
};
