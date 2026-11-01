module.exports = async () => {
  return {
    displayName: 'Unit Tests',
    roots: ['./'],
    moduleFileExtensions: ['js', 'json', 'ts'],
    transform: {
      '^.+\\.(t|j)s$': '@swc/jest',
    },
    // v8 on the TypeScript source via source maps: istanbul would count SWC's decorator helpers as branches
    coverageProvider: 'v8',
    collectCoverageFrom: [
      '**/*.ts',
      '!**/*.spec.ts',
      '!jest.config.ts',
      '!jest.setup.ts',
      '!**/test-utils.ts',
      '!main.ts',
      '!swagger.ts',
      '!**/*.interface.ts',
      '!**/*.types.ts',
      '!**/*.model.ts',
      '!compare/libs/ImageCompareInput.ts',
      '!test-runs/diffResult.ts',
      '!shared/wrapper-type.ts',
      '!test-variations/dto/test-variation-update.dto.ts',
    ],
    coverageThreshold: {
      global: { statements: 98.5, branches: 98, functions: 99, lines: 98.5 },
    },
    coverageDirectory: '../coverage',
    testEnvironment: 'node',
    setupFiles: ['<rootDir>/jest.setup.ts'],
  };
};
