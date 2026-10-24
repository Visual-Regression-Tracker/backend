/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    displayName: 'Unit Tests',
    roots: ['./'],
    moduleFileExtensions: ['js', 'json', 'ts'],
    transform: {
      // SWC only transpiles; type errors are caught once by `npm run typecheck`
      '^.+\\.(t|j)s$': '@swc/jest',
    },
    // count every source file, not just the ones some test happens to import
    // measured on the TypeScript source through source maps: istanbul would
    // instrument SWC's output and count its decorator helpers as branches
    coverageProvider: 'v8',
    collectCoverageFrom: [
      '**/*.ts',
      '!**/*.spec.ts',
      '!jest.config.ts',
      // startup only
      '!main.ts',
      '!swagger.ts',
      // types only: no code runs, so v8 would report them as never executed
      '!**/*.interface.ts',
      '!**/*.types.ts',
      '!**/*.model.ts',
      '!compare/libs/ImageCompareInput.ts',
      '!test-runs/diffResult.ts',
      '!shared/wrapper-type.ts',
      '!test-variations/dto/test-variation-update.dto.ts',
    ],
    coverageThreshold: {
      global: { statements: 98, branches: 85, functions: 98, lines: 98 },
    },
    coverageDirectory: '../coverage',
    testEnvironment: 'node',
  };
};
