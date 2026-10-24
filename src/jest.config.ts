/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    displayName: 'Unit Tests',
    roots: ['./'],
    moduleFileExtensions: ['js', 'json', 'ts'],
    transform: {
      // transpile-only: type errors are caught once by `npm run typecheck`
      '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json' }],
    },
    // count every source file, not just the ones some test happens to import
    collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!jest.config.ts', '!main.ts'],
    coverageThreshold: {
      global: { statements: 98, branches: 85, functions: 98, lines: 98 },
    },
    coverageDirectory: '../coverage',
    testEnvironment: 'node',
  };
};
